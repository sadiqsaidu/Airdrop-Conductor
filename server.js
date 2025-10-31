/*
 * =============================================================================
 * Conductor Backend - Production Ready with PostgreSQL + Wallet Adapter
 * =============================================================================
 * Key Features:
 * - PostgreSQL for scalability
 * - Wallet adapter (no private keys stored)
 * - Unsigned transaction building
 * - Sanctum Gateway integration
 * - Robust error handling
 * =============================================================================
 */

import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getMint,
} from '@solana/spl-token';
import cors from 'cors';
import { initDatabase, query, getClient, closePool } from './db.js';

// --- Configuration ---
const PORT = process.env.PORT || 4000;
const MAX_RETRIES = 3;
const RATE_LIMIT_DELAY_MS = 350;

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL;
const GATEWAY_API_URL_BASE = `https://tpg.sanctum.so/v1/${process.env.SOLANA_CLUSTER}`;
const SANCTUM_API_KEY = process.env.SANCTUM_API_KEY;
const GATEWAY_API_URL = `${GATEWAY_API_URL_BASE}?apiKey=${SANCTUM_API_KEY}`;

// --- Utility Functions ---
function toSmallestUnit(amount, decimals) {
  const amountStr = String(amount);
  const [whole, fraction = ''] = amountStr.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  const smallestUnitStr = whole + paddedFraction;
  return BigInt(smallestUnitStr);
}

// --- Express App Setup ---
const app = express();
app.use(cors());
app.use(express.json());

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- API Endpoints ---

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: 'postgresql',
  });
});

/**
 * Step 1: Create job and return unsigned transactions
 */
app.post('/api/create-job', upload.single('csvFile'), async (req, res) => {
  const { tokenMintAddress, distributorAddress, mode } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: 'No CSV file uploaded.' });
  }
  if (!tokenMintAddress || !distributorAddress || !mode) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (mode !== 'cost-saver' && mode !== 'high-assurance') {
    return res.status(400).json({ error: 'Invalid mode.' });
  }

  let tokenMintPubkey, distributorPubkey;
  try {
    tokenMintPubkey = new PublicKey(tokenMintAddress);
    distributorPubkey = new PublicKey(distributorAddress);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid address format.' });
  }

  const jobId = randomUUID();
  const csvBuffer = req.file.buffer;

  try {
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

    // Get token decimals
    const mintInfo = await getMint(connection, tokenMintPubkey);
    const tokenDecimals = mintInfo.decimals;

    // Parse CSV
    const tasks = [];
    const parser = Readable.from(csvBuffer).pipe(
      parse({ columns: true, skip_empty_lines: true, trim: true })
    );

    let taskCount = 0;
    let totalAmount = BigInt(0);

    for await (const record of parser) {
      const address = record.address?.trim();
      const amount = record.amount?.trim();

      if (!address || !amount || isNaN(Number(amount)) || Number(amount) <= 0) {
        continue;
      }

      try {
        new PublicKey(address);
      } catch {
        continue;
      }

      const amountInSmallestUnit = toSmallestUnit(amount, tokenDecimals);
      tasks.push({
        address,
        amount: amountInSmallestUnit.toString(),
      });
      totalAmount += amountInSmallestUnit;
      taskCount++;
    }

    if (taskCount === 0) {
      return res.status(400).json({ error: 'No valid tasks found in CSV.' });
    }

    // Create job in database
    await query(
      `INSERT INTO jobs (job_id, token_mint_address, token_decimals, distributor_address, mode, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [jobId, tokenMintAddress, tokenDecimals, distributorAddress, mode, 'pending']
    );

    // Insert tasks
    const client = await getClient();
    try {
      await client.query('BEGIN');
      for (const task of tasks) {
        await client.query(
          `INSERT INTO tasks (job_id, recipient_address, amount, status, retry_count)
           VALUES ($1, $2, $3, $4, $5)`,
          [jobId, task.address, task.amount, 'pending', 0]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json({
      message: `Job created with ${taskCount} tasks.`,
      job_id: jobId,
      total_tasks: taskCount,
      total_amount: totalAmount.toString(),
      token_decimals: tokenDecimals,
      mode: mode,
    });

    console.log(`[Job ${jobId}]: Created with ${taskCount} tasks`);
  } catch (err) {
    console.error(`Error creating job:`, err);
    res.status(500).json({ error: `Failed to create job: ${err.message}` });
  }
});

/**
 * Step 2: Get unsigned transactions for signing
 */
app.get('/api/get-unsigned-transactions/:job_id', async (req, res) => {
  const { job_id } = req.params;

  try {
    // Get job details
    const jobResult = await query('SELECT * FROM jobs WHERE job_id = $1', [job_id]);
    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found.' });
    }
    const job = jobResult.rows[0];

    // Get pending tasks (limit to 10 at a time to avoid overwhelming wallet)
    const tasksResult = await query(
      `SELECT * FROM tasks WHERE job_id = $1 AND status = $2 LIMIT 10`,
      [job_id, 'pending']
    );

    if (tasksResult.rows.length === 0) {
      return res.status(200).json({ transactions: [], message: 'No pending tasks.' });
    }

    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    const distributorPubkey = new PublicKey(job.distributor_address);
    const tokenMintPubkey = new PublicKey(job.token_mint_address);

    // Get distributor's token account
    const distributorTokenAccount = await getAssociatedTokenAddress(
      tokenMintPubkey,
      distributorPubkey
    );

    const unsignedTransactions = [];

    for (const task of tasksResult.rows) {
      const recipientPubkey = new PublicKey(task.recipient_address);
      const transferAmount = BigInt(task.amount);

      const recipientTokenAccount = await getAssociatedTokenAddress(
        tokenMintPubkey,
        recipientPubkey
      );

      const instructions = [];

      // Add compute budget
      instructions.push(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })
      );

      // Check if recipient ATA exists
      const recipientAtaInfo = await connection.getAccountInfo(recipientTokenAccount);
      if (!recipientAtaInfo) {
        instructions.push(
          createAssociatedTokenAccountInstruction(
            distributorPubkey,
            recipientTokenAccount,
            recipientPubkey,
            tokenMintPubkey
          )
        );
      }

      // Add transfer instruction
      instructions.push(
        createTransferInstruction(
          distributorTokenAccount,
          recipientTokenAccount,
          distributorPubkey,
          transferAmount
        )
      );

      // Build transaction
      const latestBlockhash = await connection.getLatestBlockhash('confirmed');
      const messageV0 = new TransactionMessage({
        payerKey: distributorPubkey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions,
      }).compileToV0Message();

      const unsignedTx = new VersionedTransaction(messageV0);

      // Convert to base64 for frontend
      const txBase64 = Buffer.from(unsignedTx.serialize()).toString('base64');

      unsignedTransactions.push({
        task_id: task.task_id,
        recipient: task.recipient_address,
        amount: task.amount,
        transaction: txBase64,
      });
    }

    res.status(200).json({
      job_id: job_id,
      transactions: unsignedTransactions,
    });
  } catch (err) {
    console.error(`Error getting unsigned transactions:`, err);
    res.status(500).json({ error: `Failed to get transactions: ${err.message}` });
  }
});

/**
 * Step 3: Submit signed transactions
 */
app.post('/api/submit-signed-transactions', express.json(), async (req, res) => {
  const { job_id, signed_transactions } = req.body;

  if (!job_id || !signed_transactions || !Array.isArray(signed_transactions)) {
    return res.status(400).json({ error: 'Invalid request body.' });
  }

  try {
    const jobResult = await query('SELECT * FROM jobs WHERE job_id = $1', [job_id]);
    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found.' });
    }
    const job = jobResult.rows[0];

    // Update job status to running
    await query('UPDATE jobs SET status = $1, updated_at = NOW() WHERE job_id = $2', [
      'running',
      job_id,
    ]);

    // Process each signed transaction
    const results = [];

    for (const item of signed_transactions) {
      const { task_id, transaction } = item;

      try {
        // Update task to processing
        await query(
          'UPDATE tasks SET status = $1, updated_at = NOW() WHERE task_id = $2',
          ['processing', task_id]
        );

        // Decode transaction
        const txBuffer = Buffer.from(transaction, 'base64');
        const signedTx = VersionedTransaction.deserialize(txBuffer);

        let signature;

        // Use Sanctum Gateway
        const buildParams = {
          'high-assurance': {
            cuPriceRange: 'high',
            jitoTipRange: 'high',
            deliveryMethodType: 'sanctum-sender',
            encoding: 'base64',
          },
          'cost-saver': {
            cuPriceRange: 'low',
            deliveryMethodType: 'rpc',
            encoding: 'base64',
          },
        };

        // Build with Sanctum
        const buildPayload = {
          jsonrpc: '2.0',
          id: `conductor-${job_id}-${task_id}`,
          method: 'buildGatewayTransaction',
          params: [transaction, buildParams[job.mode]],
        };

        const buildResponse = await fetch(GATEWAY_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload),
        });

        const buildResult = await buildResponse.json();
        if (buildResult.error) {
          throw new Error(`Sanctum build error: ${JSON.stringify(buildResult.error)}`);
        }

        const optimizedTx = buildResult.result.transaction;

        // Send transaction
        const sendPayload = {
          jsonrpc: '2.0',
          id: `conductor-send-${job_id}-${task_id}`,
          method: 'sendTransaction',
          params: [optimizedTx, { encoding: 'base64' }],
        };

        const sendResponse = await fetch(GATEWAY_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sendPayload),
        });

        const sendResult = await sendResponse.json();
        if (sendResult.error) {
          throw new Error(`Sanctum send error: ${JSON.stringify(sendResult.error)}`);
        }

        signature = sendResult.result;

        // Update task as success
        await query(
          `UPDATE tasks SET status = $1, tx_signature = $2, error_message = NULL, updated_at = NOW()
           WHERE task_id = $3`,
          ['success', signature, task_id]
        );

        results.push({ task_id, status: 'success', signature });
        console.log(`[Job ${job_id}]: Task ${task_id} successful. Signature: ${signature}`);
      } catch (err) {
        console.error(`[Job ${job_id}]: Task ${task_id} failed:`, err.message);

        // Update task as failed
        await query(
          `UPDATE tasks SET status = $1, error_message = $2, retry_count = retry_count + 1, updated_at = NOW()
           WHERE task_id = $3`,
          ['failed', err.message.substring(0, 500), task_id]
        );

        results.push({ task_id, status: 'failed', error: err.message });
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
    }

    // Check if all tasks are complete
    const remainingTasks = await query(
      `SELECT COUNT(*) FROM tasks WHERE job_id = $1 AND status = $2`,
      [job_id, 'pending']
    );

    if (remainingTasks.rows[0].count === '0') {
      await query('UPDATE jobs SET status = $1, updated_at = NOW() WHERE job_id = $2', [
        'completed',
        job_id,
      ]);
    }

    res.status(200).json({
      job_id,
      results,
      message: 'Transactions processed.',
    });
  } catch (err) {
    console.error(`Error submitting transactions:`, err);
    res.status(500).json({ error: `Failed to submit transactions: ${err.message}` });
  }
});

app.get('/api/job-status/:job_id', async (req, res) => {
  const { job_id } = req.params;

  try {
    const jobResult = await query('SELECT * FROM jobs WHERE job_id = $1', [job_id]);
    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found.' });
    }
    const job = jobResult.rows[0];

    const tasksResult = await query(
      `SELECT status, COUNT(*) as count FROM tasks WHERE job_id = $1 GROUP BY status`,
      [job_id]
    );

    const totalResult = await query(
      `SELECT COUNT(*) as count FROM tasks WHERE job_id = $1`,
      [job_id]
    );

    const statusCounts = {
      pending: 0,
      processing: 0,
      success: 0,
      failed: 0,
    };

    tasksResult.rows.forEach((row) => {
      if (row.status in statusCounts) {
        statusCounts[row.status] = parseInt(row.count);
      }
    });

    res.status(200).json({
      job_id: job.job_id,
      job_status: job.status,
      mode: job.mode,
      token_mint: job.token_mint_address,
      token_decimals: job.token_decimals,
      distributor_address: job.distributor_address,
      ...statusCounts,
      total: parseInt(totalResult.rows[0].count),
      error_message: job.error_message,
      created_at: job.created_at,
    });
  } catch (err) {
    console.error(`Error fetching job status:`, err);
    res.status(500).json({ error: `Failed to fetch job status: ${err.message}` });
  }
});

app.get('/api/job-tasks/:job_id', async (req, res) => {
  const { job_id } = req.params;

  try {
    const tasksResult = await query(
      `SELECT task_id, recipient_address, amount, status, retry_count, tx_signature, error_message
       FROM tasks WHERE job_id = $1 ORDER BY task_id`,
      [job_id]
    );

    res.status(200).json({
      job_id: job_id,
      tasks: tasksResult.rows,
    });
  } catch (err) {
    console.error(`Error fetching tasks:`, err);
    res.status(500).json({ error: `Failed to fetch tasks: ${err.message}` });
  }
});

app.get('/api/csv-template', (req, res) => {
  const csvContent =
    'address,amount\nYOUR_RECIPIENT_ADDRESS_HERE,1000\nANOTHER_ADDRESS_HERE,500';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="conductor_template.csv"');
  res.send(csvContent);
});

// --- Start Server ---
(async () => {
  try {
    await initDatabase();

    app.listen(PORT, () => {
      console.log(`
╔═══════════════════════════════════════════════════════════════╗
║              CONDUCTOR SERVER (PostgreSQL)                    ║
╚═══════════════════════════════════════════════════════════════╝

🚀 Server: http://localhost:${PORT}
🗄️  Database: PostgreSQL
🔑 Sanctum: ${SANCTUM_API_KEY ? '✅' : '❌'}
🌐 RPC: ${SOLANA_RPC_URL}
⚡ Cluster: ${process.env.SOLANA_CLUSTER}

Ready to process transactions! 🎉
      `);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('SIGTERM received, closing server...');
      await closePool();
      process.exit(0);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
})();