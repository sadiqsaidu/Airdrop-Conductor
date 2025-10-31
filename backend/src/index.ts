import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import campaignsRouter from './routes/campaigns';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

// Enhanced CORS configuration
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());
app.use('/api/campaigns', campaignsRouter);

app.get('/', (req, res) => res.json({ ok: true, message: 'Airdrop Conductor backend' }));

// Listen on all interfaces
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend listening on http://localhost:${PORT}`);
  console.log(`📡 API available at http://localhost:${PORT}/api/campaigns`);
});

export default app;