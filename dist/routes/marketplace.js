"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const db_1 = require("../config/db");
const router = (0, express_1.Router)();
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
        return res.json({ success: true, data: items });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch marketplace items' });
    }
});
/**
 * POST /api/marketplace
 */
router.post('/', auth_1.authenticateToken, async (req, res) => {
    try {
        const { title, description, price, category, images } = req.body;
        if (!title || !price || !category) {
            return res.status(400).json({ error: 'Title, price, and category are required' });
        }
        const item = await db_1.prisma.marketplaceItem.create({
            data: {
                sellerId: req.user.id,
                title,
                description: description || '',
                price: Number(price),
                category,
                images: images || [],
            },
        });
        return res.status(201).json({ success: true, data: item });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to create marketplace item' });
    }
});
exports.default = router;
