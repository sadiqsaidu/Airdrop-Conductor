/*
 * =============================================================================
 * Conductor Backend (server.js) - IMPROVED VERSION
 * =============================================================================
 * This file contains the complete backend for the Conductor application.
 * It is a minimal, robust, hackathon-ready server that does the following:
 *
 * 1. Runs an Express server for API endpoints.
 * 2. Uses SQLite (a local file) for all database/job queue storage.
 * 3. Provides a `/api/start-job` endpoint that:
 * - Accepts a CSV file, private key, token mint, and mode.
 * - Parses the CSV and populates a job queue in the SQLite DB.
 * 4. Provides a `/api/job-status/:job_id` endpoint for the frontend to poll.
 * 5. Provides a `/api/job-tasks/:job_id` endpoint to get detailed task info.
 * 6. Provides a `/api/cancel-job/:job_id` endpoint to cancel running jobs.
 * 7. Runs an asynchronous background worker (`processJob`) that:
 * - Processes each task from the queue.
 * - Creates SPL token transfer transactions.
 * - Calls Sanctum Gateway's `buildGatewayTransaction` to optimize.
 * - Signs the transaction.
 * - Calls Sanctum Gateway's `sendTransaction` to send.
 * - Handles retries (up to 3) on failure.
 * - Respects Sanctum rate limits with delays between requests.
 *
 * IMPROVEMENTS INCLUDED:
 * - Fixed missing import (createAssociatedTokenAccountInstruction)
 * - Added error_message column to jobs table
 * - Added rate limiting delay (350ms between tasks)
 * - Added task details endpoint
 * - Added health check endpoint
 * - Added job cancellation endpoint
 * - Better error messages and logging
 * - Token balance validation before job start
 * =============================================================================
 */

// --- Imports ---
import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import cors from 'cors';

// --- Configuration ---
const PORT = process.env.PORT || 4000;
const DB_FILE = './conductor.db';
const MAX_RETRIES = 3;
const RATE_LIMIT_DELAY_MS = 350; // ~3 requests per second (30 per 10s limit)

// NOTE: This must be pointed to the cluster you are using (e.g., devnet)
// We need this for building the transaction, Sanctum handles the sending.
const SOLANA_RPC_URL = 'https://api.devnet.solana.com';
const GATEWAY_API_URL_BASE = 'https://tpg.sanctum.so/v1/devnet'; // Using devnet endpoint
const SANCTUM_API_KEY = process.env.SANCTUM_API_KEY || 'YOUR_SANCTUM_API_KEY_HERE'; // <-- IMPORTANT

if (SANCTUM_API_KEY === 'YOUR_SANCTUM_API_KEY_HERE') {
  console.warn('!!! WARNING: SANCTUM_API_KEY is not set. Please set it in your environment variables. !!!');
}

const GATEWAY_API_URL = `${GATEWAY_API_URL_BASE}?apiKey=${SANCTUM_API_KEY}`;

// --- Database Setup ---
let db;

/**
 * Initializes the SQLite database and creates tables if they don't exist.
 */
async function setupDatabase() {
  db = await open({
    filename: DB_FILE,
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      job_id TEXT PRIMARY KEY,
      token_mint_address TEXT NOT NULL,
      distributor_private_key TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      task_id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      recipient_address TEXT NOT NULL,
      amount TEXT NOT NULL,
      status TEXT NOT NULL,
      retry_count INTEGER DEFAULT 0,
      tx_signature TEXT,
      error_message TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs (job_id)
    );
  `);

  console.log('Database initialized successfully.');
}

// --- Express App Setup ---
const app = express();
app.use(cors()); // Allow all origins for simplicity in a hackathon
app.use(express.json());

// Configure Multer for in-memory file storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- API Endpoints ---

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    sanctumConfigured: SANCTUM_API_KEY !== 'YOUR_SANCTUM_API_KEY_HERE'
  });
});

/**
 * Endpoint to start a new distribution job.
 * Accepts multipart/form-data with:
 * - csvFile: The CSV file of recipients
 * - tokenMintAddress: The SPL token to send
 * - privateKey: The distributor's private key
 * - mode: 'cost-saver' or 'high-assurance'
 */
app.post('/api/start-job', upload.single('csvFile'), async (req, res) => {
  const { tokenMintAddress, privateKey, mode } = req.body;

  // --- Basic Validation ---
  if (!req.file) {
    return res.status(400).json({ error: 'No CSV file uploaded.' });
  }
  if (!tokenMintAddress || !privateKey || !mode) {
    return res.status(400).json({ error: 'Missing required fields: tokenMintAddress, privateKey, or mode.' });
  }
  if (mode !== 'cost-saver' && mode !== 'high-assurance') {
    return res.status(400).json({ error: 'Mode must be either "cost-saver" or "high-assurance".' });
  }
  
  // Validate private key format
  let distributorKeypair;
  try {
    distributorKeypair = Keypair.fromSecretKey(bs58.decode(privateKey));
  } catch (err) {
    return res.status(400).json({ error: 'Invalid private key format. Must be base58 encoded.' });
  }

  // Validate token mint address
  let tokenMintPubkey;
  try {
    tokenMintPubkey = new PublicKey(tokenMintAddress);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid token mint address.' });
  }

  const jobId = randomUUID();
  const csvBuffer = req.file.buffer;

  try {
    // 1. Parse the CSV first to validate before creating job
    const tasks = [];
    const parser = Readable.from(csvBuffer).pipe(
      parse({ columns: true, skip_empty_lines: true, trim: true })
    );

    let taskCount = 0;
    let totalAmount = BigInt(0);

    for await (const record of parser) {
      const address = record.address?.trim();
      const amount = record.amount?.trim();
      
      // Basic CSV validation
      if (!address || !amount) {
        console.warn(`Skipping row with missing data: ${JSON.stringify(record)}`);
        continue;
      }
      
      if (isNaN(Number(amount)) || Number(amount) <= 0) {
        console.warn(`Skipping row with invalid amount: ${amount}`);
        continue;
      }
      
      try {
        // Validate Solana address
        new PublicKey(address);
      } catch (err) {
        console.warn(`Skipping invalid Solana address: ${address}`);
        continue;
      }

      tasks.push(record);
      totalAmount += BigInt(amount);
      taskCount++;
    }

    if (taskCount === 0) {
      return res.status(400).json({ error: 'CSV file is empty or contains no valid data.' });
    }

    // 2. Check token balance
    try {
      const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
      const distributorTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        distributorKeypair,
        tokenMintPubkey,
        distributorKeypair.publicKey
      );

      const balance = distributorTokenAccount.amount;
      
      if (balance < totalAmount) {
        return res.status(400).json({ 
          error: 'Insufficient token balance.',
          details: {
            required: totalAmount.toString(),
            available: balance.toString(),
            shortfall: (totalAmount - balance).toString()
          }
        });
      }

      console.log(`[Job ${jobId}]: Token balance check passed. Required: ${totalAmount}, Available: ${balance}`);
    } catch (err) {
      console.error(`[Job ${jobId}]: Token balance check failed:`, err.message);
      return res.status(400).json({ 
        error: 'Failed to verify token balance. Please check your wallet and token mint address.',
        details: err.message
      });
    }

    // 3. Insert the main job
    await db.run(
      'INSERT INTO jobs (job_id, token_mint_address, distributor_private_key, mode, status) VALUES (?, ?, ?, ?, ?)',
      [jobId, tokenMintAddress, privateKey, mode, 'pending']
    );

    // 4. Insert tasks
    await db.run('BEGIN TRANSACTION');
    const stmt = await db.prepare(
      'INSERT INTO tasks (job_id, recipient_address, amount, status, retry_count) VALUES (?, ?, ?, ?, ?)'
    );
    for (const task of tasks) {
      await stmt.run(jobId, task.address, task.amount, 'pending', 0);
    }
    await stmt.finalize();
    await db.run('COMMIT');

    // 5. Respond to frontend immediately
    res.status(202).json({
      message: `Job started with ${taskCount} tasks.`,
      job_id: jobId,
      total_tasks: taskCount,
      total_amount: totalAmount.toString(),
      mode: mode
    });

    // 6. Trigger the job processor asynchronously
    console.log(`[Job ${jobId}]: Triggering job processor for ${taskCount} tasks`);
    processJob(jobId); // Note: Not awaited

  } catch (err) {
    console.error(`Error starting job ${jobId}:`, err);
    // Clean up if job creation failed
    try {
      await db.run('DELETE FROM jobs WHERE job_id = ?', jobId);
      await db.run('DELETE FROM tasks WHERE job_id = ?', jobId);
    } catch (cleanupErr) {
      console.error(`Failed to clean up job ${jobId}:`, cleanupErr);
    }
    res.status(500).json({ error: `Failed to start job: ${err.message}` });
  }
});

/**
 * Endpoint for the frontend to poll for job status.
 */
app.get('/api/job-status/:job_id', async (req, res) => {
  const { job_id } = req.params;

  try {
    const job = await db.get('SELECT * FROM jobs WHERE job_id = ?', job_id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    const tasks = await db.all('SELECT status, COUNT(*) as count FROM tasks WHERE job_id = ? GROUP BY status', job_id);
    const totalTasks = await db.get('SELECT COUNT(*) as count FROM tasks WHERE job_id = ?', job_id);

    const statusCounts = {
      pending: 0,
      processing: 0,
      success: 0,
      failed: 0,
    };

    tasks.forEach(task => {
      if (task.status in statusCounts) {
        statusCounts[task.status] = task.count;
      }
    });

    res.status(200).json({
      job_id: job.job_id,
      job_status: job.status,
      mode: job.mode,
      token_mint: job.token_mint_address,
      ...statusCounts,
      total: totalTasks.count,
      error_message: job.error_message,
      created_at: job.created_at
    });

  } catch (err) {
    console.error(`Error fetching status for job ${job_id}:`, err.message);
    res.status(500).json({ error: `Failed to fetch job status: ${err.message}` });
  }
});

/**
 * Endpoint to get detailed task information for a job
 */
app.get('/api/job-tasks/:job_id', async (req, res) => {
  const { job_id } = req.params;

  try {
    const job = await db.get('SELECT job_id FROM jobs WHERE job_id = ?', job_id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    const tasks = await db.all(
      `SELECT 
        task_id, 
        recipient_address, 
        amount, 
        status, 
        retry_count,
        tx_signature, 
        error_message 
      FROM tasks 
      WHERE job_id = ? 
      ORDER BY task_id`,
      job_id
    );

    res.status(200).json({
      job_id: job_id,
      tasks: tasks
    });

  } catch (err) {
    console.error(`Error fetching tasks for job ${job_id}:`, err.message);
    res.status(500).json({ error: `Failed to fetch tasks: ${err.message}` });
  }
});

/**
 * Endpoint to cancel a running job
 */
app.post('/api/cancel-job/:job_id', async (req, res) => {
  const { job_id } = req.params;

  try {
    const job = await db.get('SELECT * FROM jobs WHERE job_id = ?', job_id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    if (job.status !== 'running' && job.status !== 'pending') {
      return res.status(400).json({ error: `Cannot cancel job with status: ${job.status}` });
    }

    // Update job status to cancelled
    await db.run(
      'UPDATE jobs SET status = ?, error_message = ? WHERE job_id = ?',
      ['cancelled', 'Job cancelled by user', job_id]
    );

    // Cancel all pending tasks
    await db.run(
      'UPDATE tasks SET status = ?, error_message = ? WHERE job_id = ? AND status = ?',
      ['failed', 'Job cancelled by user', job_id, 'pending']
    );

    console.log(`[Job ${job_id}]: Cancelled by user`);

    res.status(200).json({
      message: 'Job cancelled successfully',
      job_id: job_id
    });

  } catch (err) {
    console.error(`Error cancelling job ${job_id}:`, err.message);
    res.status(500).json({ error: `Failed to cancel job: ${err.message}` });
  }
});

/**
 * Endpoint to download CSV template
 */
app.get('/api/csv-template', (req, res) => {
  const csvContent = 'address,amount\nYOUR_RECIPIENT_ADDRESS_HERE,1000000\nANOTHER_ADDRESS_HERE,500000';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="conductor_template.csv"');
  res.send(csvContent);
});

// --- Job Processing Worker ---

/**
 * The main job processor. Fetches and processes tasks from the queue.
 * @param {string} jobId - The ID of the job to process.
 */
async function processJob(jobId) {
  console.log(`[Worker ${jobId}]: Starting...`);
  let connection;
  let job;

  try {
    job = await db.get('SELECT * FROM jobs WHERE job_id = ?', jobId);
    if (!job) {
      throw new Error('Job not found in database.');
    }

    await db.run('UPDATE jobs SET status = ? WHERE job_id = ?', ['running', jobId]);
    
    // Setup Solana connection and distributor keypair
    connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    const distributorKeypair = Keypair.fromSecretKey(bs58.decode(job.distributor_private_key));
    const tokenMintPubkey = new PublicKey(job.token_mint_address);

    console.log(`[Worker ${jobId}]: Distributor Wallet: ${distributorKeypair.publicKey.toBase58()}`);
    console.log(`[Worker ${jobId}]: Token Mint: ${tokenMintPubkey.toBase58()}`);
    console.log(`[Worker ${jobId}]: Mode: ${job.mode}`);

    // Get the distributor's token account
    const distributorTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      distributorKeypair,
      tokenMintPubkey,
      distributorKeypair.publicKey
    );
    console.log(`[Worker ${jobId}]: Distributor ATA: ${distributorTokenAccount.address.toBase58()}`);

    // Loop until all tasks are processed
    let running = true;
    while (running) {
      // Check if job was cancelled
      const currentJob = await db.get('SELECT status FROM jobs WHERE job_id = ?', jobId);
      if (currentJob.status === 'cancelled') {
        console.log(`[Worker ${jobId}]: Job was cancelled. Stopping.`);
        running = false;
        break;
      }

      const task = await db.get(
        'SELECT * FROM tasks WHERE job_id = ? AND status = ? AND retry_count < ? LIMIT 1',
        [jobId, 'pending', MAX_RETRIES]
      );

      if (!task) {
        console.log(`[Worker ${jobId}]: No pending tasks found. Job complete.`);
        running = false;
        break;
      }

      console.log(`[Worker ${jobId}]: Processing task ${task.task_id} (Recipient: ${task.recipient_address}, Amount: ${task.amount})`);
      await db.run(
        'UPDATE tasks SET status = ? WHERE task_id = ?',
        ['processing', task.task_id]
      );

      try {
        // --- Core Transaction Logic ---
        
        // 1. Get recipient info
        const recipientPubkey = new PublicKey(task.recipient_address);
        // We use BigInt for token amounts to avoid precision errors
        const transferAmount = BigInt(task.amount); 

        // 2. Find recipient's ATA
        const recipientTokenAccount = await getAssociatedTokenAddress(
          tokenMintPubkey,
          recipientPubkey
        );

        // 3. Build the v0 transaction
        // We must check if the recipient's ATA exists.
        // If it doesn't, we MUST include the create ATA instruction.
        const instructions = [];
        const recipientAtaInfo = await connection.getAccountInfo(recipientTokenAccount);
        if (!recipientAtaInfo) {
          console.log(`[Worker ${jobId}]: Recipient ATA not found. Creating one.`);
          instructions.push(
            createAssociatedTokenAccountInstruction(
              distributorKeypair.publicKey, // Payer
              recipientTokenAccount,        // ATA
              recipientPubkey,              // Owner
              tokenMintPubkey               // Mint
            )
          );
        }

        // Add the main transfer instruction
        instructions.push(
          createTransferInstruction(
            distributorTokenAccount.address, // From
            recipientTokenAccount,           // To
            distributorKeypair.publicKey,    // Owner
            transferAmount                   // Amount
          )
        );
        
        // 4. Create the v0 Transaction
        let latestBlockhash = await connection.getLatestBlockhash('confirmed');
        const messageV0 = new TransactionMessage({
          payerKey: distributorKeypair.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions,
        }).compileToV0Message();
        
        const unsignedTx = new VersionedTransaction(messageV0);

        // 5. CALL SANCTUM: buildGatewayTransaction
        const buildParams = {
          "high-assurance": {
            cuPriceRange: "high",
            jitoTipRange: "high",
            deliveryMethodType: "sanctum-sender"
          },
          "cost-saver": {
            cuPriceRange: "low",
            deliveryMethodType: "rpc"
          }
        };

        const rpcPayload = {
          jsonrpc: "2.0",
          id: `conductor-${jobId}-${task.task_id}`,
          method: "buildGatewayTransaction",
          params: [
            bs58.encode(unsignedTx.serialize()),
            buildParams[job.mode]
          ]
        };

        const buildResponse = await fetch(GATEWAY_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rpcPayload),
        });

        if (!buildResponse.ok) {
          const errorText = await buildResponse.text();
          throw new Error(`Sanctum buildGatewayTransaction failed (${buildResponse.status}): ${errorText}`);
        }

        const buildResult = await buildResponse.json();
        if (buildResult.error) {
          throw new Error(`Sanctum buildGatewayTransaction error: ${JSON.stringify(buildResult.error)}`);
        }
        
        const encodedTransaction = buildResult.result.transaction;

        // 6. Sign the transaction returned by Sanctum
        const rebuiltTx = VersionedTransaction.deserialize(bs58.decode(encodedTransaction));
        rebuiltTx.sign([distributorKeypair]);

        // 7. CALL SANCTUM: sendTransaction
        const sendPayload = {
          jsonrpc: "2.0",
          id: `conductor-send-${jobId}-${task.task_id}`,
          method: "sendTransaction",
          params: [
            bs58.encode(rebuiltTx.serialize()),
            { encoding: "base58" }
          ]
        };

        const sendResponse = await fetch(GATEWAY_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sendPayload),
        });

        if (!sendResponse.ok) {
          const errorText = await sendResponse.text();
          throw new Error(`Sanctum sendTransaction failed (${sendResponse.status}): ${errorText}`);
        }
        
        const sendResult = await sendResponse.json();
        if (sendResult.error) {
          throw new Error(`Sanctum sendTransaction error: ${JSON.stringify(sendResult.error)}`);
        }

        const signature = sendResult.result;
        console.log(`[Worker ${jobId}]: Task ${task.task_id} successful. Signature: ${signature}`);

        // --- Success ---
        await db.run(
          'UPDATE tasks SET status = ?, tx_signature = ?, error_message = NULL WHERE task_id = ?',
          ['success', signature, task.task_id]
        );

        // Rate limiting delay
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));

      } catch (err) {
        // --- Failure & Retry Logic ---
        console.error(`[Worker ${jobId}]: Task ${task.task_id} failed. Error: ${err.message}`);
        const newRetryCount = task.retry_count + 1;
        
        if (newRetryCount >= MAX_RETRIES) {
          await db.run(
            'UPDATE tasks SET status = ?, retry_count = ?, error_message = ? WHERE task_id = ?',
            ['failed', newRetryCount, err.message.substring(0, 500), task.task_id]
          );
          console.log(`[Worker ${jobId}]: Task ${task.task_id} failed permanently after ${MAX_RETRIES} retries.`);
        } else {
          // Set back to 'pending' to be picked up again
          await db.run(
            'UPDATE tasks SET status = ?, retry_count = ?, error_message = ? WHERE task_id = ?',
            ['pending', newRetryCount, err.message.substring(0, 500), task.task_id]
          );
          console.log(`[Worker ${jobId}]: Task ${task.task_id} will retry (${newRetryCount}/${MAX_RETRIES})`);
          
          // Add a longer delay before retry
          await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS * 2));
        }
      }
    }
    
    // Final job status update
    const currentJobStatus = await db.get('SELECT status FROM jobs WHERE job_id = ?', jobId);
    if (currentJobStatus.status === 'running') {
      await db.run('UPDATE jobs SET status = ? WHERE job_id = ?', ['completed', jobId]);
      console.log(`[Worker ${jobId}]: Job finished successfully.`);
    } else {
      console.log(`[Worker ${jobId}]: Job finished with status: ${currentJobStatus.status}`);
    }

  } catch (err) {
    console.error(`[Worker ${jobId}]: A fatal error occurred: ${err.message}`);
    await db.run(
      'UPDATE jobs SET status = ?, error_message = ? WHERE job_id = ?',
      ['failed', err.message.substring(0, 500), jobId]
    );
  }
}

// --- Start Server ---
(async () => {
  await setupDatabase();
  app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                  CONDUCTOR SERVER READY                       ║
╚═══════════════════════════════════════════════════════════════╝

🚀 Server listening on: http://localhost:${PORT}
🔑 Sanctum API Key: ${SANCTUM_API_KEY === 'YOUR_SANCTUM_API_KEY_HERE' ? '⚠️  NOT SET' : '✅ Configured'}
📊 Database: ${DB_FILE}
🌐 Solana RPC: ${SOLANA_RPC_URL}
⚡ Gateway URL: ${GATEWAY_API_URL_BASE}

Available Endpoints:
  GET  /api/health
  POST /api/start-job
  GET  /api/job-status/:job_id
  GET  /api/job-tasks/:job_id
  POST /api/cancel-job/:job_id
  GET  /api/csv-template

${SANCTUM_API_KEY === 'YOUR_SANCTUM_API_KEY_HERE' ? '⚠️  WARNING: Set SANCTUM_API_KEY environment variable before starting jobs!\n' : ''}Ready to process transactions! 🎉
    `);
  });
})();