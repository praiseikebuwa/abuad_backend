import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { prisma } from '../config/db';

const router = Router();

function safeParseImages(imagesRaw: any): string[] {
  if (Array.isArray(imagesRaw)) return imagesRaw;
  if (typeof imagesRaw === 'string') {
    try {
      const parsed = JSON.parse(imagesRaw);
      if (Array.isArray(parsed)) return parsed;
      return [imagesRaw];
    } catch (_) {
      return imagesRaw.length > 0 ? [imagesRaw] : [];
    }
  }
  return [];
}

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

    const formatted = items.map((item) => ({
      ...item,
      images: safeParseImages(item.images),
    }));

    return res.json({ success: true, data: formatted });
  } catch (error: any) {
    console.error('Fetch marketplace error:', error);
    return res.status(500).json({ error: 'Failed to fetch marketplace items' });
  }
});

/**
 * POST /api/marketplace
 */
router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, description, price, category, images, status } = req.body;
    if (!title || price === undefined || !category) {
      return res.status(400).json({ error: 'Title, price, and category are required' });
    }

    const numPrice = typeof price === 'number' ? price : parseFloat(String(price).replace(/,/g, ''));
    if (isNaN(numPrice)) {
      return res.status(400).json({ error: 'Valid price is required' });
    }

    const imagesJson = Array.isArray(images)
      ? JSON.stringify(images)
      : typeof images === 'string'
      ? (images.startsWith('[') ? images : JSON.stringify([images]))
      : '[]';

    const item = await prisma.marketplaceItem.create({
      data: {
        sellerId: req.user!.id,
        title: String(title).trim(),
        description: description ? String(description).trim() : '',
        price: numPrice,
        category: String(category),
        images: imagesJson,
        status: status || 'AVAILABLE',
      },
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

    const formatted = {
      ...item,
      images: safeParseImages(item.images),
    };

    return res.status(201).json({ success: true, data: formatted });
  } catch (error: any) {
    console.error('Create marketplace item error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to create marketplace item' });
  }
});

/**
 * DELETE /api/marketplace/:id
 */
router.delete('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const item = await prisma.marketplaceItem.findUnique({ where: { id } });
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }
    if (item.sellerId !== req.user!.id && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Not authorized to delete this item' });
    }

    await prisma.marketplaceItem.delete({ where: { id } });
    return res.json({ success: true, message: 'Item deleted successfully' });
  } catch (error: any) {
    console.error('Delete marketplace error:', error);
    return res.status(500).json({ error: 'Failed to delete marketplace item' });
  }
});

export default router;

