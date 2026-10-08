import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { prisma } from '../config/db';

const router = Router();

/**
 * GET /api/marketplace
 */
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { category } = req.query;
    const items = await prisma.marketplaceItem.findMany({
      where: category ? { category: String(category) } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        seller: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });
    return res.json({ success: true, data: items });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch marketplace items' });
  }
});

/**
 * POST /api/marketplace
 */
router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, description, price, category, images } = req.body;
    if (!title || !price || !category) {
      return res.status(400).json({ error: 'Title, price, and category are required' });
    }

    const item = await prisma.marketplaceItem.create({
      data: {
        sellerId: req.user!.id,
        title,
        description: description || '',
        price: Number(price),
        category,
        images: images || [],
      },
    });

    return res.status(201).json({ success: true, data: item });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create marketplace item' });
  }
});

export default router;

