"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const db_1 = require("../config/db");
const router = (0, express_1.Router)();
function safeParseImages(imagesRaw) {
    if (Array.isArray(imagesRaw))
        return imagesRaw;
    if (typeof imagesRaw === 'string') {
        try {
            const parsed = JSON.parse(imagesRaw);
            if (Array.isArray(parsed))
                return parsed;
            return [imagesRaw];
        }
        catch (_) {
            return imagesRaw.length > 0 ? [imagesRaw] : [];
        }
    }
    return [];
}
/**
 * GET /api/marketplace
 */
router.get('/', auth_1.authenticateToken, async (req, res) => {
    try {
        const { category } = req.query;
        const items = await db_1.prisma.marketplaceItem.findMany({
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
    }
    catch (error) {
        console.error('Fetch marketplace error:', error);
        return res.status(500).json({ error: 'Failed to fetch marketplace items' });
    }
});
/**
 * POST /api/marketplace
 */
router.post('/', auth_1.authenticateToken, async (req, res) => {
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
        const item = await db_1.prisma.marketplaceItem.create({
            data: {
                sellerId: req.user.id,
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
    }
    catch (error) {
        console.error('Create marketplace item error:', error);
        return res.status(500).json({ error: error?.message || 'Failed to create marketplace item' });
    }
});
/**
 * DELETE /api/marketplace/:id
 */
router.delete('/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const id = String(req.params.id);
        const item = await db_1.prisma.marketplaceItem.findUnique({ where: { id } });
        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }
        if (item.sellerId !== req.user.id && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Not authorized to delete this item' });
        }
        await db_1.prisma.marketplaceItem.delete({ where: { id } });
        return res.json({ success: true, message: 'Item deleted successfully' });
    }
    catch (error) {
        console.error('Delete marketplace error:', error);
        return res.status(500).json({ error: 'Failed to delete marketplace item' });
    }
});
exports.default = router;
