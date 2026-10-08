import { Router, Response } from 'express';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { prisma } from '../config/db';

const router = Router();

/**
 * GET /api/admin/reports or /api/reports
 */
router.get(['/', '/reports'], authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const reports = await prisma.report.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: {
          select: { id: true, username: true, fullName: true, email: true },
        },
      },
    });
    return res.json({ success: true, data: reports });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

/**
 * GET & POST /api/admin/config or /api/system/config
 */
router.get(['/', '/config', '/system/config'], authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const settings = await prisma.systemSetting.findMany();
    const configMap: Record<string, any> = {};
    settings.forEach(s => {
      try {
        configMap[s.key] = JSON.parse(s.value);
      } catch {
        configMap[s.key] = s.value;
      }
    });
    return res.json({ success: true, data: configMap });
  } catch (error) {
    return res.json({ success: true, data: { maintenanceMode: false, appVersion: '1.0.0' } });
  }
});

router.post(['/', '/config', '/system/config'], authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'Key is required' });
    const strVal = typeof value === 'object' ? JSON.stringify(value) : String(value);
    const setting = await prisma.systemSetting.upsert({
      where: { key },
      update: { value: strVal },
      create: { key, value: strVal },
    });
    return res.json({ success: true, data: setting });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to save config' });
  }
});

/**
 * GET & POST /api/admin/announcements or /api/announcements
 */
router.get(['/', '/announcements'], authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const announcements = await prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return res.json({ success: true, data: announcements });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

router.post(['/', '/announcements'], authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, body, target } = req.body;
    const item = await prisma.announcement.create({
      data: {
        title: title || 'System Announcement',
        body: body || '',
        target: target || 'everyone',
      }
    });
    return res.status(201).json({ success: true, data: item });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create announcement' });
  }
});

/**
 * GET & POST /api/admin/resources or /api/resources
 */
router.get(['/', '/resources'], authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const resources = await prisma.resource.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        uploader: {
          select: { id: true, username: true, fullName: true }
        }
      }
    });
    return res.json({ success: true, data: resources });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch resources' });
  }
});

router.post(['/', '/resources'], authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, description, category, fileUrl } = req.body;
    const item = await prisma.resource.create({
      data: {
        title: title || 'Untitled Resource',
        description: description || '',
        category: category || 'General',
        fileUrl: fileUrl || '',
        uploaderId: req.user!.id,
      }
    });
    return res.status(201).json({ success: true, data: item });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create resource' });
  }
});

/**
 * GET /api/admin/verification-requests
 */
router.get('/verification-requests', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const requests = await prisma.verificationRequest.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, username: true, fullName: true, email: true },
        },
      },
    });
    return res.json({ success: true, data: requests });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch verification requests' });
  }
});

/**
 * POST /api/admin/verification-requests/:id/approve
 */
router.post('/verification-requests/:id/approve', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const requestId = String(req.params.id);
    const requestItem = await prisma.verificationRequest.findUnique({ where: { id: requestId } });
    if (!requestItem) return res.status(404).json({ error: 'Request not found' });

    await prisma.$transaction([
      prisma.verificationRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED' },
      }),
      prisma.user.update({
        where: { id: String(requestItem.userId) },
        data: { isVerified: true, verificationType: requestItem.type },
      }),
    ]);

    return res.json({ success: true, message: 'Verification request approved' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to process verification' });
  }
});

/**
 * GET & POST /api/admin/audit-logs
 */
router.get('/audit-logs', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return res.json({ success: true, data: logs });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

router.post('/audit-logs', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { action, details } = req.body;
    const log = await prisma.auditLog.create({
      data: {
        adminId: req.user!.id,
        action: action || 'UNKNOWN',
        details: details || '',
      }
    });
    return res.status(201).json({ success: true, data: log });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to log action' });
  }
});

export default router;

