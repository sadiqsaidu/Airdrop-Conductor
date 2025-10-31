/*
 * =============================================================================
 * Conductor Backend - WITH ENHANCED DEBUGGING & ERROR HANDLING
 * =============================================================================
 * Added:
 * - Detailed transaction logging before sending to Sanctum
 * - Better error messages from Sanctum API
 * - Option to use direct RPC as fallback
 * - Transaction simulation before sending
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
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getMint,
} from '@solana/spl-token';
import bs58 from 'bs58';
import cors from 'cors';

// --- Configuration ---
const PORT = process.env.PORT || 4000;
const DB_FILE = './conductor.db';
const MAX_RETRIES = 3;
const RATE_LIMIT_DELAY_MS = 350;
const USE_SANCTUM_GATEWAY = true; // Set to false to use direct RPC
const ENABLE_DEBUG_LOGGING = true; // Set to false to reduce logs

const SOLANA_RPC_URL = 'https://api.devnet.solana.com';
const GATEWAY_API_URL_BASE = 'https://tpg.sanctum.so/v1/devnet';
const SANCTUM_API_KEY = process.env.SANCTUM_API_KEY || 'YOUR_SANCTUM_API_KEY_HERE';

if (SANCTUM_API_KEY === 'YOUR_SANCTUM_API_KEY_HERE') {
  console.warn('!!! WARNING: SANCTUM_API_KEY is not set. Please set it in your environment variables. !!!');
}

const GATEWAY_API_URL = `${GATEWAY_API_URL_BASE}?apiKey=${SANCTUM_API_KEY}`;

// --- Database Setup ---
let db;

async function setupDatabase() {
  db = await open({
    filename: DB_FILE,
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      job_id TEXT PRIMARY KEY,
      token_mint_address TEXT NOT NULL,
      token_decimals INTEGER NOT NULL,
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

// --- Utility Functions ---

function toSmallestUnit(amount, decimals) {
  const amountStr = String(amount);
  const [whole, fraction = ''] = amountStr.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  const smallestUnitStr = whole + paddedFraction;
  return BigInt(smallestUnitStr);
}

function debugLog(message, data = null) {
  if (ENABLE_DEBUG_LOGGING) {
    console.log(`[DEBUG] ${message}`, data || '');
  }
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
    sanctumConfigured: SANCTUM_API_KEY !== 'YOUR_SANCTUM_API_KEY_HERE',
    usingSanctumGateway: USE_SANCTUM_GATEWAY
  });
});

app.post('/api/start-job', upload.single('csvFile'), async (req, res) => {
  const { tokenMintAddress, privateKey, mode } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: 'No CSV file uploaded.' });
  }
  if (!tokenMintAddress || !privateKey || !mode) {
    return res.status(400).json({ error: 'Missing required fields: tokenMintAddress, privateKey, or mode.' });
  }
  if (mode !== 'cost-saver' && mode !== 'high-assurance') {
    return res.status(400).json({ error: 'Mode must be either "cost-saver" or "high-assurance".' });
  }
  
  let distributorKeypair;
  try {
    distributorKeypair = Keypair.fromSecretKey(bs58.decode(privateKey));
  } catch (err) {
    return res.status(400).json({ error: 'Invalid private key format. Must be base58 encoded.' });
  }

  let tokenMintPubkey;
  try {
    tokenMintPubkey = new PublicKey(tokenMintAddress);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid token mint address.' });
  }

  const jobId = randomUUID();
  const csvBuffer = req.file.buffer;

  try {
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    
    const mintInfo = await getMint(connection, tokenMintPubkey);
    const tokenDecimals = mintInfo.decimals;
    console.log(`[Job ${jobId}]: Token decimals: ${tokenDecimals}`);

    const tasks = [];
    const parser = Readable.from(csvBuffer).pipe(
      parse({ columns: true, skip_empty_lines: true, trim: true })
    );

    let taskCount = 0;
    let totalAmount = BigInt(0);

    for await (const record of parser) {
      const address = record.address?.trim();
      const amount = record.amount?.trim();
      
      if (!address || !amount) {
        console.warn(`Skipping row with missing data: ${JSON.stringify(record)}`);
        continue;
      }
      
      if (isNaN(Number(amount)) || Number(amount) <= 0) {
        console.warn(`Skipping row with invalid amount: ${amount}`);
        continue;
      }
      
      try {
        new PublicKey(address);
      } catch (err) {
        console.warn(`Skipping invalid Solana address: ${address}`);
        continue;
      }

      const amountInSmallestUnit = toSmallestUnit(amount, tokenDecimals);
      
      tasks.push({
        address,
        amount: amountInSmallestUnit.toString()
      });
      totalAmount += amountInSmallestUnit;
      taskCount++;
    }

    if (taskCount === 0) {
      return res.status(400).json({ error: 'CSV file is empty or contains no valid data.' });
    }

    try {
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

    await db.run(
      'INSERT INTO jobs (job_id, token_mint_address, token_decimals, distributor_private_key, mode, status) VALUES (?, ?, ?, ?, ?, ?)',
      [jobId, tokenMintAddress, tokenDecimals, privateKey, mode, 'pending']
    );

    await db.run('BEGIN TRANSACTION');
    const stmt = await db.prepare(
      'INSERT INTO tasks (job_id, recipient_address, amount, status, retry_count) VALUES (?, ?, ?, ?, ?)'
    );
    for (const task of tasks) {
      await stmt.run(jobId, task.address, task.amount, 'pending', 0);
    }
    await stmt.finalize();
    await db.run('COMMIT');

    res.status(202).json({
      message: `Job started with ${taskCount} tasks.`,
      job_id: jobId,
      total_tasks: taskCount,
      total_amount: totalAmount.toString(),
      token_decimals: tokenDecimals,
      mode: mode
    });

    console.log(`[Job ${jobId}]: Triggering job processor for ${taskCount} tasks`);
    processJob(jobId);

  } catch (err) {
    console.error(`Error starting job ${jobId}:`, err);
    try {
      await db.run('DELETE FROM jobs WHERE job_id = ?', jobId);
      await db.run('DELETE FROM tasks WHERE job_id = ?', jobId);
    } catch (cleanupErr) {
      console.error(`Failed to clean up job ${jobId}:`, cleanupErr);
    }
    res.status(500).json({ error: `Failed to start job: ${err.message}` });
  }
});

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
      token_decimals: job.token_decimals,
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

    await db.run(
      'UPDATE jobs SET status = ?, error_message = ? WHERE job_id = ?',
      ['cancelled', 'Job cancelled by user', job_id]
    );

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

app.get('/api/csv-template', (req, res) => {
  const csvContent = 'address,amount\nYOUR_RECIPIENT_ADDRESS_HERE,1000000\nANOTHER_ADDRESS_HERE,500000';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="conductor_template.csv"');
  res.send(csvContent);
});

// --- Job Processing Worker ---

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
    
    connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    const distributorKeypair = Keypair.fromSecretKey(bs58.decode(job.distributor_private_key));
    const tokenMintPubkey = new PublicKey(job.token_mint_address);

    console.log(`[Worker ${jobId}]: Distributor Wallet: ${distributorKeypair.publicKey.toBase58()}`);
    console.log(`[Worker ${jobId}]: Token Mint: ${tokenMintPubkey.toBase58()}`);
    console.log(`[Worker ${jobId}]: Token Decimals: ${job.token_decimals}`);
    console.log(`[Worker ${jobId}]: Mode: ${job.mode}`);
    console.log(`[Worker ${jobId}]: Using ${USE_SANCTUM_GATEWAY ? 'Sanctum Gateway' : 'Direct RPC'}`);

    const distributorTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      distributorKeypair,
      tokenMintPubkey,
      distributorKeypair.publicKey
    );
    console.log(`[Worker ${jobId}]: Distributor ATA: ${distributorTokenAccount.address.toBase58()}`);

    let running = true;
    while (running) {
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
        const recipientPubkey = new PublicKey(task.recipient_address);
        const transferAmount = BigInt(task.amount);

        const recipientTokenAccount = await getAssociatedTokenAddress(
          tokenMintPubkey,
          recipientPubkey
        );

        const instructions = [];
        
        // Add compute budget for priority fees
        instructions.push(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })
        );

        const recipientAtaInfo = await connection.getAccountInfo(recipientTokenAccount);
        if (!recipientAtaInfo) {
          console.log(`[Worker ${jobId}]: Creating recipient ATA for ${task.recipient_address}`);
          instructions.push(
            createAssociatedTokenAccountInstruction(
              distributorKeypair.publicKey,
              recipientTokenAccount,
              recipientPubkey,
              tokenMintPubkey
            )
          );
        }

        instructions.push(
          createTransferInstruction(
            distributorTokenAccount.address,
            recipientTokenAccount,
            distributorKeypair.publicKey,
            transferAmount
          )
        );
        
        let latestBlockhash = await connection.getLatestBlockhash('confirmed');
        const messageV0 = new TransactionMessage({
          payerKey: distributorKeypair.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions,
        }).compileToV0Message();
        
        const unsignedTx = new VersionedTransaction(messageV0);

        debugLog(`Transaction instructions count: ${instructions.length}`);
        debugLog(`Transaction serialized size: ${unsignedTx.serialize().length} bytes`);

        let signature;

        if (USE_SANCTUM_GATEWAY) {
          // Use Sanctum Gateway with correct base64 encoding
          const buildParams = {
            "high-assurance": {
              cuPriceRange: "high",
              jitoTipRange: "high",
              deliveryMethodType: "sanctum-sender",
              encoding: "base64"
            },
            "cost-saver": {
              cuPriceRange: "low",
              deliveryMethodType: "rpc",
              encoding: "base64"
            }
          };

          debugLog(`Calling Sanctum buildGatewayTransaction with mode: ${job.mode}`);

          // Convert to base64 (Sanctum expects base64, not base58)
          const txBase64 = Buffer.from(unsignedTx.serialize()).toString('base64');

          const rpcPayload = {
            jsonrpc: "2.0",
            id: `conductor-${jobId}-${task.task_id}`,
            method: "buildGatewayTransaction",
            params: [
              txBase64,
              buildParams[job.mode]
            ]
          };

          debugLog(`RPC Payload:`, JSON.stringify(rpcPayload, null, 2));

          const buildResponse = await fetch(GATEWAY_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rpcPayload),
          });

          const buildResponseText = await buildResponse.text();
          debugLog(`Build response status: ${buildResponse.status}`);
          debugLog(`Build response body: ${buildResponseText}`);

          if (!buildResponse.ok) {
            throw new Error(`Sanctum buildGatewayTransaction failed (${buildResponse.status}): ${buildResponseText}`);
          }

          const buildResult = JSON.parse(buildResponseText);
          if (buildResult.error) {
            throw new Error(`Sanctum buildGatewayTransaction error: ${JSON.stringify(buildResult.error)}`);
          }
          
          const encodedTransaction = buildResult.result.transaction;

          // Decode from base64
          const rebuiltTx = VersionedTransaction.deserialize(
            Buffer.from(encodedTransaction, 'base64')
          );
          rebuiltTx.sign([distributorKeypair]);

          // Send with base64 encoding
          const signedTxBase64 = Buffer.from(rebuiltTx.serialize()).toString('base64');

          const sendPayload = {
            jsonrpc: "2.0",
            id: `conductor-send-${jobId}-${task.task_id}`,
            method: "sendTransaction",
            params: [
              signedTxBase64,
              { encoding: "base64" }
            ]
          };

          const sendResponse = await fetch(GATEWAY_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sendPayload),
          });

          const sendResponseText = await sendResponse.text();
          debugLog(`Send response status: ${sendResponse.status}`);
          debugLog(`Send response body: ${sendResponseText}`);

          if (!sendResponse.ok) {
            throw new Error(`Sanctum sendTransaction failed (${sendResponse.status}): ${sendResponseText}`);
          }
          
          const sendResult = JSON.parse(sendResponseText);
          if (sendResult.error) {
            throw new Error(`Sanctum sendTransaction error: ${JSON.stringify(sendResult.error)}`);
          }

          signature = sendResult.result;

        } else {
          // Direct RPC fallback
          console.log(`[Worker ${jobId}]: Using direct RPC submission`);
          unsignedTx.sign([distributorKeypair]);
          
          signature = await connection.sendTransaction(unsignedTx, {
            maxRetries: 3,
            skipPreflight: false,
          });

          // Wait for confirmation
          await connection.confirmTransaction({
            signature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          }, 'confirmed');
        }

        console.log(`[Worker ${jobId}]: Task ${task.task_id} successful. Signature: ${signature}`);

        await db.run(
          'UPDATE tasks SET status = ?, tx_signature = ?, error_message = NULL WHERE task_id = ?',
          ['success', signature, task.task_id]
        );

        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));

      } catch (err) {
        console.error(`[Worker ${jobId}]: Task ${task.task_id} failed. Error: ${err.message}`);
        if (ENABLE_DEBUG_LOGGING) {
          console.error(`[Worker ${jobId}]: Full error:`, err);
        }
        
        const newRetryCount = task.retry_count + 1;
        
        if (newRetryCount >= MAX_RETRIES) {
          await db.run(
            'UPDATE tasks SET status = ?, retry_count = ?, error_message = ? WHERE task_id = ?',
            ['failed', newRetryCount, err.message.substring(0, 500), task.task_id]
          );
          console.log(`[Worker ${jobId}]: Task ${task.task_id} failed permanently after ${MAX_RETRIES} retries.`);
        } else {
          await db.run(
            'UPDATE tasks SET status = ?, retry_count = ?, error_message = ? WHERE task_id = ?',
            ['pending', newRetryCount, err.message.substring(0, 500), task.task_id]
          );
          console.log(`[Worker ${jobId}]: Task ${task.task_id} will retry (${newRetryCount}/${MAX_RETRIES})`);
          
          await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS * 2));
        }
      }
    }
    
    const currentJobStatus = await db.get('SELECT status FROM jobs WHERE job_id = ?', jobId);
    if (currentJobStatus.status === 'running') {
      await db.run('UPDATE jobs SET status = ? WHERE job_id = ?', ['completed', jobId]);
      console.log(`[Worker ${jobId}]: Job finished successfully.`);
    } else {
      console.log(`[Worker ${jobId}]: Job finished with status: ${currentJobStatus.status}`);
    }

  } catch (err) {
    console.error(`[Worker ${jobId}]: A fatal error occurred: ${err.message}`);
    if (ENABLE_DEBUG_LOGGING) {
      console.error(`[Worker ${jobId}]: Full error:`, err);
    }
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
🔧 Mode: ${USE_SANCTUM_GATEWAY ? 'Sanctum Gateway' : 'Direct RPC'}
🐛 Debug Logging: ${ENABLE_DEBUG_LOGGING ? 'Enabled' : 'Disabled'}

Available Endpoints:
  GET  /api/health
  POST /api/start-job
  GET  /api/job-status/:job_id
  GET  /api/job-tasks/:job_id
  POST /api/cancel-job/:job_id
  GET  /api/csv-template

${SANCTUM_API_KEY === 'YOUR_SANCTUM_API_KEY_HERE' && USE_SANCTUM_GATEWAY ? '⚠️  WARNING: Set SANCTUM_API_KEY environment variable!\n' : ''}Ready to process transactions! 🎉
    `);
  });
})();