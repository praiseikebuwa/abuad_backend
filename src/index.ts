import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import postRoutes from './routes/posts';
import chatRoutes from './routes/chat';
import marketplaceRoutes from './routes/marketplace';
import eventRoutes from './routes/events';
import storyRoutes from './routes/stories';
import aiRoutes from './routes/ai';
import mediaRoutes from './routes/media';
import utilityRoutes from './routes/utilities';
import adminRoutes from './routes/admin';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ABUAD API Backend (JWT Native Auth)', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/utilities', utilityRoutes);
app.use('/api/admin', adminRoutes);

// Direct collection alias routes for legacy/admin client calls
app.use('/api/system', adminRoutes);
app.use('/api/system/config', adminRoutes);
app.use('/api/resources', adminRoutes);
app.use('/api/announcements', adminRoutes);
app.use('/api/reports', adminRoutes);
app.use('/api/marketplace_items', marketplaceRoutes);
app.use('/api/groups', eventRoutes);
app.use('/api/channels', chatRoutes);
app.use('/api/sos_alerts', utilityRoutes);
app.use('/api/notifications', utilityRoutes);
app.use('/api/presence', utilityRoutes);

import { scheduleAiAutonomousPosting } from './services/aiBotService';

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`🚀 ABUAD Backend Server running on http://localhost:${PORT}`);
  scheduleAiAutonomousPosting();
});
