"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const db_1 = require("../config/db");
const router = (0, express_1.Router)();
/**
 * GET /api/events
 */
router.get('/', auth_1.authenticateToken, async (req, res) => {
    try {
        const events = await db_1.prisma.event.findMany({
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
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch events' });
    }
});
/**
 * POST /api/events
 */
router.post('/', auth_1.authenticateToken, async (req, res) => {
    try {
        const { title, description, location, date, bannerUrl } = req.body;
        if (!title || !location || !date) {
            return res.status(400).json({ error: 'Title, location, and date are required' });
        }
        const event = await db_1.prisma.event.create({
            data: {
                organizerId: req.user.id,
                title,
                description: description || '',
                location,
                date: new Date(date),
                bannerUrl: bannerUrl || null,
            },
        });
        return res.status(201).json({ success: true, data: event });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to create event' });
    }
});
exports.default = router;
