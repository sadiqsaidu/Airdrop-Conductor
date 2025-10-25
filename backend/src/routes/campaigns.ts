import express from 'express';
import { PrismaClient } from '@prisma/client';
import { DistributorService } from '../services/distributor.service';
import multer from 'multer';
import Papa from 'papaparse';

const router = express.Router();
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/campaigns - Create new campaign
router.post('/', upload.single('file'), async (req: express.Request & { file?: Express.Multer.File }, res: express.Response) => {
  try {
    const { name, tokenMint, tokenDecimals, mode, batchSize, maxRetries } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'CSV file required' });
    }

    // Parse CSV
    const csvContent = file.buffer.toString('utf-8');
    const parsed = Papa.parse(csvContent, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
    });

    const recipients = (parsed.data as any[]).map((row: any) => ({
      address: row.address?.trim(),
      amount: parseFloat(row.amount),
    }));

    // Validate recipients
    if (recipients.length === 0) {
      return res.status(400).json({ error: 'No valid recipients found' });
    }

    // Create campaign
    const campaign = await prisma.campaign.create({
      data: {
        name,
        tokenMint,
        tokenDecimals: parseInt(tokenDecimals),
        mode,
        batchSize: parseInt(batchSize) || 20,
        maxRetries: parseInt(maxRetries) || 3,
        totalRecipients: recipients.length,
        sourceTokenAccount: req.body.sourceTokenAccount,
        authorityWallet: req.body.authorityWallet,
        recipients: {
          create: recipients,
        },
      },
    });

    res.json({ campaign });
  } catch (error: any) {
    console.error('Campaign creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/campaigns/:id/execute - Execute campaign
router.post('/:id/execute', async (req, res) => {
  try {
    const { id } = req.params;

    const distributor = new DistributorService(
      process.env.GATEWAY_API_KEY!,
      process.env.SOLANA_RPC_URL!,
      Buffer.from(process.env.WALLET_PRIVATE_KEY!, 'base64')
    );

    // Execute asynchronously
    distributor.executeCampaign(id).catch(console.error);

    res.json({ message: 'Campaign execution started' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/campaigns/:id - Get campaign status
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        recipients: {
          orderBy: { createdAt: 'desc' },
          take: 20, // Last 20 transactions
        },
      },
    });

    res.json({ campaign });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;