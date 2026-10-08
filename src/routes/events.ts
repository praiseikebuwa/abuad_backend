import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { prisma } from '../config/db';

const router = Router();

/**
 * GET /api/events
 */
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const events = await prisma.event.findMany({
      orderBy: { date: 'asc' },
      include: {
        organizer: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });
    return res.json({ success: true, data: events });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch events' });
  }
});

/**
 * POST /api/events
 */
router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, description, location, date, bannerUrl } = req.body;
    if (!title || !location || !date) {
      return res.status(400).json({ error: 'Title, location, and date are required' });
    }

    const event = await prisma.event.create({
      data: {
        organizerId: req.user!.id,
        title,
        description: description || '',
        location,
        date: new Date(date),
        bannerUrl: bannerUrl || null,
      },
    });

    return res.status(201).json({ success: true, data: event });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create event' });
  }
});

export default router;

