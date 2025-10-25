import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import campaignsRouter from './routes/campaigns';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

app.use(cors());
app.use(express.json());
app.use('/api/campaigns', campaignsRouter);

app.get('/', (req, res) => res.json({ ok: true, message: 'Airdrop Conductor backend' }));

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});

export default app;
