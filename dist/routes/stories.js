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
        const parsedStories = stories.map((s) => {
            let viewers = [];
            let likes = [];
            let mentions = [];
            try {
                viewers = typeof s.viewers === 'string' ? JSON.parse(s.viewers || '[]') : (s.viewers || []);
            }
            catch (_) { }
            try {
                likes = typeof s.likes === 'string' ? JSON.parse(s.likes || '[]') : (s.likes || []);
            }
            catch (_) { }
            try {
                mentions = typeof s.mentions === 'string' ? JSON.parse(s.mentions || '[]') : (s.mentions || []);
            }
            catch (_) { }
            return {
                ...s,
                viewers,
                likes,
                mentions,
                userName: s.author?.fullName || s.author?.username || '',
                userAvatar: s.author?.avatarUrl || '',
            };
        });
        return res.json({ success: true, data: parsedStories });
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
        const { mediaUrl, content, mediaType, type, caption, linkUrl, mentions } = req.body;
        const finalMediaUrl = mediaUrl || content || (type === 'text' || mediaType === 'text' ? 'text' : '');
        if (!finalMediaUrl && type !== 'text' && mediaType !== 'text') {
            return res.status(400).json({ error: 'Media URL is required for story' });
        }
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 Hours duration
        const mentionsJson = Array.isArray(mentions) ? JSON.stringify(mentions) : (typeof mentions === 'string' ? mentions : '[]');
        const story = await db_1.prisma.story.create({
            data: {
                authorId: req.user.id,
                mediaUrl: finalMediaUrl || 'text',
                mediaType: (mediaType || type || 'image').toUpperCase(),
                caption: caption || null,
                linkUrl: linkUrl || null,
                mentions: mentionsJson,
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
        let viewers = [];
        let likes = [];
        let mentionsList = [];
        try {
            viewers = typeof story.viewers === 'string' ? JSON.parse(story.viewers || '[]') : (story.viewers || []);
        }
        catch (_) { }
        try {
            likes = typeof story.likes === 'string' ? JSON.parse(story.likes || '[]') : (story.likes || []);
        }
        catch (_) { }
        try {
            mentionsList = typeof story.mentions === 'string' ? JSON.parse(story.mentions || '[]') : (story.mentions || []);
        }
        catch (_) { }
        return res.status(201).json({
            success: true,
            data: {
                ...story,
                viewers,
                likes,
                mentions: mentionsList,
                userName: story.author?.fullName || story.author?.username || '',
                userAvatar: story.author?.avatarUrl || '',
            },
        });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to post story' });
    }
});
/**
 * POST /api/stories/:id/view - Record a view on story
 */
router.post('/:id/view', auth_1.authenticateToken, async (req, res) => {
    try {
        const id = String(req.params.id);
        const userId = req.user.id;
        const story = await db_1.prisma.story.findUnique({ where: { id } });
        if (!story) {
            return res.status(404).json({ error: 'Story not found' });
        }
        let viewers = [];
        try {
            viewers = typeof story.viewers === 'string' ? JSON.parse(story.viewers || '[]') : (story.viewers || []);
        }
        catch (_) { }
        if (!viewers.includes(userId)) {
            viewers.push(userId);
            await db_1.prisma.story.update({
                where: { id },
                data: {
                    viewers: JSON.stringify(viewers),
                    viewersCount: viewers.length,
                },
            });
        }
        return res.json({ success: true, viewersCount: viewers.length });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to record story view' });
    }
});
/**
 * POST /api/stories/:id/like - Toggle like on story
 */
router.post('/:id/like', auth_1.authenticateToken, async (req, res) => {
    try {
        const id = String(req.params.id);
        const userId = req.user.id;
        const { isLiking } = req.body;
        const story = await db_1.prisma.story.findUnique({ where: { id } });
        if (!story) {
            return res.status(404).json({ error: 'Story not found' });
        }
        let likes = [];
        try {
            likes = typeof story.likes === 'string' ? JSON.parse(story.likes || '[]') : (story.likes || []);
        }
        catch (_) { }
        if (isLiking === true) {
            if (!likes.includes(userId))
                likes.push(userId);
        }
        else if (isLiking === false) {
            likes = likes.filter((uid) => uid !== userId);
        }
        else {
            if (likes.includes(userId)) {
                likes = likes.filter((uid) => uid !== userId);
            }
            else {
                likes.push(userId);
            }
        }
        await db_1.prisma.story.update({
            where: { id },
            data: {
                likes: JSON.stringify(likes),
                likesCount: likes.length,
            },
        });
        return res.json({ success: true, likesCount: likes.length, hasLiked: likes.includes(userId) });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to update story like' });
    }
});
/**
 * DELETE /api/stories/:id - Delete a story
 */
router.delete('/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const id = String(req.params.id);
        const userId = req.user.id;
        const story = await db_1.prisma.story.findUnique({ where: { id } });
        if (!story) {
            return res.status(404).json({ error: 'Story not found' });
        }
        if (story.authorId !== userId) {
            return res.status(403).json({ error: 'Unauthorized to delete this story' });
        }
        await db_1.prisma.story.delete({ where: { id } });
        return res.json({ success: true, message: 'Story deleted successfully' });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to delete story' });
    }
});
exports.default = router;
