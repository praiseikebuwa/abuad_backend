"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const db_1 = require("../config/db");
const router = (0, express_1.Router)();
/**
 * GET /api/stories - Get active 24h stories
 */
router.get('/', auth_1.authenticateToken, async (req, res) => {
    try {
        const now = new Date();
        const stories = await db_1.prisma.story.findMany({
            where: {
                expiresAt: { gt: now },
            },
            orderBy: { createdAt: 'desc' },
            include: {
                author: {
                    select: {
                        id: true,
                        username: true,
                        fullName: true,
                        avatarUrl: true,
                    },
                },
            },
        });
        return res.json({ success: true, data: stories });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch stories' });
    }
});
/**
 * POST /api/stories
 */
router.post('/', auth_1.authenticateToken, async (req, res) => {
    try {
        const { mediaUrl, content, mediaType, type, caption } = req.body;
        const finalMediaUrl = mediaUrl || content || (type === 'text' || mediaType === 'text' ? 'text' : '');
        if (!finalMediaUrl && type !== 'text' && mediaType !== 'text') {
            return res.status(400).json({ error: 'Media URL is required for story' });
        }
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 Hours duration
        const story = await db_1.prisma.story.create({
            data: {
                authorId: req.user.id,
                mediaUrl: finalMediaUrl || 'text',
                mediaType: (mediaType || type || 'image').toUpperCase(),
                caption: caption || null,
                expiresAt,
            },
            include: {
                author: {
                    select: {
                        id: true,
                        username: true,
                        fullName: true,
                        avatarUrl: true,
                    },
                },
            },
        });
        return res.status(201).json({ success: true, data: story });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to post story' });
    }
});
exports.default = router;
