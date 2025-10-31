import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Initialize database schema
export async function initDatabase() {
  const client = await pool.connect();
  try {
    // Create jobs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        job_id UUID PRIMARY KEY,
        token_mint_address TEXT NOT NULL,
        token_decimals INTEGER NOT NULL,
        distributor_address TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create tasks table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        task_id SERIAL PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
        recipient_address TEXT NOT NULL,
        amount TEXT NOT NULL,
        status TEXT NOT NULL,
        retry_count INTEGER DEFAULT 0,
        tx_signature TEXT,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_job_id ON tasks(job_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    `);

    console.log('✅ Database schema initialized successfully');
  } catch (err) {
    console.error('❌ Error initializing database:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Helper function to execute queries
export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 1000) {
    console.log('⚠️  Slow query detected:', { text, duration, rows: res.rowCount });
  }
  return res;
}

// Get a client from the pool for transactions
export async function getClient() {
  return await pool.connect();
}

// Graceful shutdown
export async function closePool() {
  await pool.end();
  console.log('🔌 Database pool closed');
}

export default pool;