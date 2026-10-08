import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { prisma } from '../config/db';

const router = Router();

/**
 * GET /api/utilities/sos or /api/sos_alerts - Get SOS alerts
 */
router.get(['/', '/sos', '/sos_alerts'], authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const alerts = await prisma.sOSAlert.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: { select: { id: true, username: true, fullName: true, avatarUrl: true } },
      },
    });
    return res.json({ success: true, data: alerts });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch SOS alerts' });
  }
});

/**
 * POST /api/utilities/sos - Broadcast SOS Alert
 */
router.post('/sos', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { latitude, longitude, message } = req.body;
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const alert = await prisma.sOSAlert.create({
      data: {
        userId: req.user!.id,
        latitude: Number(latitude),
        longitude: Number(longitude),
        message: message || 'EMERGENCY SOS ALERT',
      },
    });

    return res.status(201).json({ success: true, data: alert });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to dispatch SOS alert' });
  }
});

/**
 * PATCH /api/utilities/sos/:id/resolve - Resolve an SOS alert
 */
router.patch('/sos/:id/resolve', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await prisma.sOSAlert.update({ where: { id: String(req.params.id) }, data: { status: 'RESOLVED' } });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to resolve SOS alert' });
  }
});

/**
 * GET /api/utilities/notifications - User notifications
 */
router.get('/notifications', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;

    // Purge any historical self-notifications where the user performed the action on their own content
    await prisma.notification.deleteMany({
      where: {
        userId: currentUserId,
        senderId: currentUserId,
      },
    }).catch(() => {});

    const notifications = await prisma.notification.findMany({
      where: {
        userId: currentUserId,
        NOT: {
          senderId: currentUserId,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const senderIds = Array.from(new Set(notifications.map(n => n.senderId).filter(Boolean))) as string[];
    const senders = senderIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: senderIds } },
          select: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true, verificationType: true }
        })
      : [];
    const senderMap = new Map(senders.map(s => [s.id, s]));

    const enriched = notifications.map(n => {
      const sender = n.senderId ? senderMap.get(n.senderId) : null;
      return {
        id: n.id,
        userId: n.userId,
        recipient_id: n.userId,
        senderId: n.senderId,
        sender_id: n.senderId,
        senderName: sender?.fullName || sender?.username || 'User',
        sender_name: sender?.fullName || sender?.username || 'User',
        senderAvatarUrl: sender?.avatarUrl || null,
        sender_avatar_url: sender?.avatarUrl || null,
        senderHandle: sender?.username || '',
        senderIsVerified: sender?.isVerified || false,
        senderVerificationType: sender?.verificationType || 'NONE',
        title: n.title,
        body: n.body,
        type: n.type,
        relatedId: (n as any).relatedId || null,
        related_id: (n as any).relatedId || null,
        isRead: n.isRead,
        is_read: n.isRead,
        createdAt: n.createdAt,
        timestamp: n.createdAt,
      };
    });

    return res.json({ success: true, data: enriched });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

/**
 * POST /api/utilities/notifications - Create a notification
 */
router.post('/notifications', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId, recipientId, title, body, type, relatedId } = req.body;
    const targetUserId = recipientId || userId;
    const senderId = req.user!.id;

    // Never allow a user to receive notifications for their own actions
    if (!targetUserId || targetUserId === senderId) {
      return res.status(200).json({ success: true, message: 'Self-notification skipped' });
    }

    const notification = await (prisma.notification.create as any)({
      data: {
        userId: targetUserId,
        senderId,
        title: title || 'Notification',
        body: body || '',
        type: type || 'system',
        relatedId: relatedId || null,
      },
    });
    return res.status(201).json({ success: true, data: notification });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create notification' });
  }
});

/**
 * DELETE /api/utilities/notifications/:id - Delete single notification
 */
router.delete('/notifications/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await prisma.notification.deleteMany({
      where: {
        id: String(req.params.id),
        userId: req.user!.id,
      },
    });
    return res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete notification' });
  }
});

/**
 * DELETE /api/utilities/notifications - Delete multiple notifications or clear all
 */
router.delete('/notifications', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { ids } = req.body || {};
    if (Array.isArray(ids) && ids.length > 0) {
      await prisma.notification.deleteMany({
        where: {
          id: { in: ids.map((id: any) => String(id)) },
          userId: req.user!.id,
        },
      });
    } else {
      await prisma.notification.deleteMany({
        where: {
          userId: req.user!.id,
        },
      });
    }
    return res.json({ success: true, message: 'Notifications deleted' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete notifications' });
  }
});

/**
 * PATCH /api/utilities/notifications/:id/read - Mark notification as read
 */
router.patch('/notifications/:id/read', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await prisma.notification.updateMany({
      where: { id: String(req.params.id), userId: req.user!.id },
      data: { isRead: true }
    });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

/**
 * PATCH /api/utilities/notifications/read-all - Mark all notifications as read
 */
router.patch('/notifications/read-all', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user!.id, isRead: false },
      data: { isRead: true }
    });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

/**
 * GET /api/utilities/presence - Get all online users
 */
router.get('/presence', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const presence = await prisma.presence.findMany({
      where: { status: 'online' },
      include: {
        user: { select: { id: true, username: true, fullName: true, avatarUrl: true } },
      },
    });
    return res.json({ success: true, data: presence });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch presence' });
  }
});

/**
 * PUT /api/utilities/presence - Update own presence status
 */
router.put('/presence', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status } = req.body;
    await prisma.presence.upsert({
      where: { userId: req.user!.id },
      update: { status: status || 'online', lastSeen: new Date() },
      create: { userId: req.user!.id, status: status || 'online', lastSeen: new Date() },
    });
    // Also update the user's status field
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { status: status || 'online', lastSeen: new Date() },
    });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update presence' });
  }
});

/**
 * GET /api/utilities/lost-found - Get lost & found items
 */
router.get('/lost-found', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const items = await prisma.lostAndFoundItem.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        reporter: { select: { id: true, username: true, fullName: true, avatarUrl: true } },
      },
    });
    return res.json({ success: true, data: items });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch lost and found items' });
  }
});

/**
 * POST /api/utilities/lost-found - Report a lost or found item
 */
router.post('/lost-found', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, description, location, status, imageUrl } = req.body;
    if (!title || !location) return res.status(400).json({ error: 'Title and location are required' });

    const item = await prisma.lostAndFoundItem.create({
      data: {
        reporterId: req.user!.id,
        title,
        description: description || '',
        location,
        status: status || 'LOST',
        imageUrl: imageUrl || null,
      },
    });
    return res.status(201).json({ success: true, data: item });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to report lost/found item' });
  }
});

/**
 * PATCH /api/utilities/lost-found/:id/claim - Mark item as claimed
 */
router.patch('/lost-found/:id/claim', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await prisma.lostAndFoundItem.update({ where: { id: String(req.params.id) }, data: { status: 'CLAIMED' } });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to mark item as claimed' });
  }
});

/**
 * GET /api/utilities/shuttle - Shuttle locations
 */
router.get('/shuttle', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shuttles = await prisma.shuttleLocation.findMany();
    return res.json({ success: true, data: shuttles });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch shuttle locations' });
  }
});

/**
 * PUT /api/utilities/shuttle/:shuttleId - Update shuttle location (driver only)
 */
router.put('/shuttle/:shuttleId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { latitude, longitude, driverName } = req.body;
    await prisma.shuttleLocation.upsert({
      where: { shuttleId: String(req.params.shuttleId) },
      update: { latitude, longitude, driverName },
      create: { shuttleId: String(req.params.shuttleId), latitude, longitude, driverName },
    });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update shuttle location' });
  }
});

/**
 * POST /api/utilities/report - Report content
 */
router.post('/report', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { targetId, targetType, reason } = req.body;
    if (!targetId || !targetType || !reason) {
      return res.status(400).json({ error: 'targetId, targetType, and reason are required' });
    }
    const report = await prisma.report.create({
      data: {
        reporterId: req.user!.id,
        targetId,
        targetType,
        reason,
      },
    });
    return res.status(201).json({ success: true, data: report });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to submit report' });
  }
});

export default router;

