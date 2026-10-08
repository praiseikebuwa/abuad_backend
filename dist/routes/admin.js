"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const db_1 = require("../config/db");
const router = (0, express_1.Router)();
/**
 * GET /api/admin/reports or /api/reports
 */
router.get(['/', '/reports'], auth_1.authenticateToken, async (req, res) => {
    try {
        const reports = await db_1.prisma.report.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                reporter: {
                    select: { id: true, username: true, fullName: true, email: true },
                },
            },
        });
        return res.json({ success: true, data: reports });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch reports' });
    }
});
/**
 * GET & POST /api/admin/config or /api/system/config
 */
router.get(['/', '/config', '/system/config'], auth_1.authenticateToken, async (req, res) => {
    try {
        const settings = await db_1.prisma.systemSetting.findMany();
        const configMap = {};
        settings.forEach(s => {
            try {
                configMap[s.key] = JSON.parse(s.value);
            }
            catch {
                configMap[s.key] = s.value;
            }
        });
        return res.json({ success: true, data: configMap });
    }
    catch (error) {
        return res.json({ success: true, data: { maintenanceMode: false, appVersion: '1.0.0' } });
    }
});
router.post(['/', '/config', '/system/config'], auth_1.authenticateToken, async (req, res) => {
    try {
        const { key, value } = req.body;
        if (!key)
            return res.status(400).json({ error: 'Key is required' });
        const strVal = typeof value === 'object' ? JSON.stringify(value) : String(value);
        const setting = await db_1.prisma.systemSetting.upsert({
            where: { key },
            update: { value: strVal },
            create: { key, value: strVal },
        });
        return res.json({ success: true, data: setting });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to save config' });
    }
});
/**
 * GET & POST /api/admin/announcements or /api/announcements
 */
router.get(['/', '/announcements'], auth_1.authenticateToken, async (req, res) => {
    try {
        const announcements = await db_1.prisma.announcement.findMany({
            orderBy: { createdAt: 'desc' }
        });
        return res.json({ success: true, data: announcements });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch announcements' });
    }
});
router.post(['/', '/announcements'], auth_1.authenticateToken, async (req, res) => {
    try {
        const { title, body, target } = req.body;
        const item = await db_1.prisma.announcement.create({
            data: {
                title: title || 'System Announcement',
                body: body || '',
                target: target || 'everyone',
            }
        });
        return res.status(201).json({ success: true, data: item });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to create announcement' });
    }
});
/**
 * GET & POST /api/admin/resources or /api/resources
 */
router.get(['/', '/resources'], auth_1.authenticateToken, async (req, res) => {
    try {
        const resources = await db_1.prisma.resource.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                uploader: {
                    select: { id: true, username: true, fullName: true }
                }
            }
        });
        return res.json({ success: true, data: resources });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch resources' });
    }
});
router.post(['/', '/resources'], auth_1.authenticateToken, async (req, res) => {
    try {
        const { title, description, category, fileUrl } = req.body;
        const item = await db_1.prisma.resource.create({
            data: {
                title: title || 'Untitled Resource',
                description: description || '',
                category: category || 'General',
                fileUrl: fileUrl || '',
                uploaderId: req.user.id,
            }
        });
        return res.status(201).json({ success: true, data: item });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to create resource' });
    }
});
/**
 * GET /api/admin/verification-requests
 */
router.get('/verification-requests', auth_1.authenticateToken, async (req, res) => {
    try {
        const requests = await db_1.prisma.verificationRequest.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                user: {
                    select: { id: true, username: true, fullName: true, email: true },
                },
            },
        });
        return res.json({ success: true, data: requests });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch verification requests' });
    }
});
/**
 * POST /api/admin/verification-requests/:id/approve
 */
router.post('/verification-requests/:id/approve', auth_1.authenticateToken, async (req, res) => {
    try {
        const requestId = String(req.params.id);
        const requestItem = await db_1.prisma.verificationRequest.findUnique({ where: { id: requestId } });
        if (!requestItem)
            return res.status(404).json({ error: 'Request not found' });
        await db_1.prisma.$transaction([
            db_1.prisma.verificationRequest.update({
                where: { id: requestId },
                data: { status: 'APPROVED' },
            }),
            db_1.prisma.user.update({
                where: { id: String(requestItem.userId) },
                data: { isVerified: true, verificationType: requestItem.type },
            }),
        ]);
        return res.json({ success: true, message: 'Verification request approved' });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to process verification' });
    }
});
/**
 * GET & POST /api/admin/audit-logs
 */
router.get('/audit-logs', auth_1.authenticateToken, async (req, res) => {
    try {
        const logs = await db_1.prisma.auditLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
        return res.json({ success: true, data: logs });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});
router.post('/audit-logs', auth_1.authenticateToken, async (req, res) => {
    try {
        const { action, details } = req.body;
        const log = await db_1.prisma.auditLog.create({
            data: {
                adminId: req.user.id,
                action: action || 'UNKNOWN',
                details: details || '',
            }
        });
        return res.status(201).json({ success: true, data: log });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to log action' });
    }
});
exports.default = router;
