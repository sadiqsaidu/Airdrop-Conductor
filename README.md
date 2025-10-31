# 🎯 Conductor 

A production ready bulk token distribution system for Solana, powered by Sanctum Gateway for optimized transaction delivery.

## 📋 What It Is

Conductor is a service that enables efficient bulk token distribution on Solana. It processes CSV files containing recipient addresses and amounts, then orchestrates the creation, signing, and submission of multiple token transfer transactions through Sanctum Gateway.

## 🎯 What It Solves

**The Problem:**
- Manually sending tokens to multiple recipients is time-consuming and error-prone
- Transaction failures on Solana due to network congestion
- Lack of visibility into bulk distribution progress
- Difficult to optimize for cost vs. speed tradeoffs

**The Solution:**
- **Batch Processing**: Upload a CSV, distribute to hundreds/thousands of recipients
- **High Reliability**: Leverages Sanctum Gateway's multi-path transaction delivery
- **Flexible Modes**: Choose between cost-efficient or high-assurance delivery
- **Progress Tracking**: Real-time status monitoring for all transactions
- **Wallet Security**: Uses wallet adapters (no private keys stored on server)

## 🏗️ Technical Architecture

```
┌─────────────┐
│   Client    │
│  (Frontend) │
└──────┬──────┘
       │
       │ 1. Upload CSV
       ▼
┌─────────────────────────────────────┐
│      Express.js API Server          │
├─────────────────────────────────────┤
│  • Job Creation & Management        │
│  • CSV Parsing                      │
│  • Transaction Building             │
│  • Status Tracking                  │
└──────┬──────────────────┬───────────┘
       │                  │
       │ 2. Unsigned Txs  │ 3. Store State
       ▼                  ▼
┌─────────────┐    ┌──────────────┐
│   Wallet    │    │  PostgreSQL  │
│  (Signing)  │    │   Database   │
└──────┬──────┘    └──────────────┘
       │
       │ 4. Signed Txs
       ▼
┌─────────────────────────────────────┐
│       Sanctum Gateway API           │
├─────────────────────────────────────┤
│  🔧 buildGatewayTransaction         │
│     • Simulation & CU optimization  │
│     • Priority fee calculation      │
│     • Tip instruction injection     │
│                                     │
│  🚀 sendTransaction                 │
│     • Multi-path delivery           │
│     • RPC + Jito routing            │
│     • Automatic tip refunds         │
└──────┬──────────────────────────────┘
       │
       │ 5. Submit to Network
       ▼
┌─────────────────────────────────────┐
│        Solana Blockchain            │
│  • Validators                       │
│  • Jito Block Engine                │
│  • RPCs/SWQoS                       │
└─────────────────────────────────────┘
```

## 🔄 Workflow

### 1️⃣ Job Creation
- Client uploads CSV with recipient addresses and amounts
- Server validates data and creates job in PostgreSQL
- Tasks are stored with `pending` status

### 2️⃣ Transaction Building
- Server builds unsigned transactions for each task
- Creates Associated Token Accounts if needed
- Adds compute budget instructions
- Returns base64-encoded transactions to client

### 3️⃣ Client-Side Signing
- Wallet adapter signs transactions securely
- Private keys never leave the user's browser
- Signed transactions returned to server

### 4️⃣ Sanctum Gateway Processing
- **buildGatewayTransaction**: Optimizes each transaction
  - Simulates for accurate compute units
  - Calculates priority fees based on mode
  - Injects tip instructions
  - Sets appropriate blockhash
- **sendTransaction**: Delivers via optimal path
  - Routes through RPCs, Jito, or transaction senders
  - Handles retries automatically
  - Refunds unused Jito tips

### 5️⃣ Status Tracking
- Database updated with transaction signatures
- Real-time progress available via API
- Failed tasks can be retried

## 🚦 Delivery Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| **Cost Saver** 💰 | Low priority fees, RPC delivery | Non-urgent distributions, cost-sensitive |
| **High Assurance** ⚡ | High priority fees, Sanctum Sender | Time-critical, high-value distributions |

## 🗄️ Database Schema

### `jobs` Table
Tracks distribution jobs with metadata and overall status.

### `tasks` Table
Individual transfer tasks with recipient, amount, status, and transaction signature.

## 🔌 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/create-job` | POST | Create new distribution job |
| `/api/get-unsigned-transactions/:job_id` | GET | Fetch transactions to sign |
| `/api/submit-signed-transactions` | POST | Submit signed transactions |
| `/api/job-status/:job_id` | GET | Get job progress |
| `/api/job-tasks/:job_id` | GET | Get detailed task list |
| `/api/csv-template` | GET | Download CSV template |

## 🛠️ Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL
- **Blockchain**: Solana (web3.js, spl-token)
- **Transaction Gateway**: Sanctum Gateway
- **CSV Processing**: csv-parse
- **File Upload**: Multer

## 🔐 Security Features

- ✅ No private keys stored on server
- ✅ Wallet adapter pattern (client-side signing)
- ✅ API key authentication for Sanctum Gateway
- ✅ Environment variable configuration
- ✅ Input validation and sanitization

## 📦 Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@host:port/dbname

# Solana
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_CLUSTER=mainnet

# Sanctum Gateway
SANCTUM_API_KEY=your_api_key_here

# Server
PORT=4000
```

## 🚀 Getting Started

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Initialize database
npm run init-db

# Start server
npm start
```

## 📊 Rate Limiting

- **Default**: 30 requests per 10 seconds (Sanctum Gateway limit)
- **Internal**: 350ms delay between transactions
- **Batch Size**: 10 unsigned transactions per request

## 🎯 Key Benefits

1. **Reliability**: Multi-path transaction delivery through Sanctum Gateway
2. **Scalability**: PostgreSQL handles thousands of tasks efficiently
3. **Flexibility**: Switch between cost/speed modes without code changes
4. **Visibility**: Complete audit trail of all transactions
5. **Security**: Private keys never touch the server

## 📝 CSV Format

```csv
address,amount
<recipient_solana_address>,<amount_in_tokens>
<recipient_solana_address>,<amount_in_tokens>
```

Example:
```csv
address,amount
7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU,100.5
9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM,250.0
```

## 🤝 Contributing

This is a production-ready backend designed for bulk token distribution. Contributions are welcome!

## 📄 License

MIT

---

Built with ❤️ for the Solana ecosystem, powered by Sanctum Gateway