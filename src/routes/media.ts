import { Router, Request, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { generateR2UploadUrl, r2PublicDomain, r2BucketName, r2Client } from '../config/cloudflare';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import multer from 'multer';

const router = Router();
// Use memory storage so we can pipe bytes directly to R2
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
});

/**
 * Helper to build public media URL with CORS proxy support
 */
function buildPublicUrl(req: Request, key: string): string {
  const host = req.get('host') || 'localhost:5000';
  const protocol = req.protocol || 'http';
  return `${protocol}://${host}/api/media/file/${key}`;
}

/**
 * GET /api/media/file/*
 * Stream media object directly from Cloudflare R2 with full CORS headers
 */
router.get('/file/*', async (req: Request, res: Response) => {
  try {
    const key = req.params[0];
    if (!key) {
      return res.status(400).send('File key required');
    }

    const command = new GetObjectCommand({
      Bucket: r2BucketName,
      Key: key,
    });

    const s3Object = await r2Client.send(command);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    if (s3Object.ContentType) {
      res.setHeader('Content-Type', s3Object.ContentType);
    }
    if (s3Object.ContentLength) {
      res.setHeader('Content-Length', s3Object.ContentLength.toString());
    }

    const stream = s3Object.Body as any;
    if (stream && typeof stream.pipe === 'function') {
      stream.pipe(res);
    } else if (stream && typeof stream.transformToByteArray === 'function') {
      const byteArray = await stream.transformToByteArray();
      res.send(Buffer.from(byteArray));
    } else {
      res.status(404).send('File stream unavailable');
    }
  } catch (error: any) {
    if (error?.code === 'ETIMEDOUT' || error?.name === 'TimeoutError' || error?.name === 'AggregateError') {
      console.warn(`Media stream storage connection timeout for key "${req.params[0]}": ${error.message || 'Timeout'}`);
      return res.status(504).send('Storage connection timeout');
    }
    console.error('Media stream error:', error);
    res.status(404).send('File not found');
  }
});

/**
 * GET /api/media/proxy
 * Proxy any R2 or external media URL to bypass browser CORS restrictions in Flutter Web
 */
router.get('/proxy', async (req: Request, res: Response) => {
  try {
    const rawUrl = req.query.url as string;
    if (!rawUrl || typeof rawUrl !== 'string') {
      return res.status(400).send('Media URL parameter required');
    }

    // Extract key if it's an R2 URL
    if (rawUrl.includes('r2.dev/') || rawUrl.includes('cloudflarestorage.com/')) {
      const parts = rawUrl.split('/uploads/');
      if (parts.length > 1) {
        const key = `uploads/${parts[1]}`;
        try {
          const s3Object = await r2Client.send(new GetObjectCommand({
            Bucket: r2BucketName,
            Key: key,
          }));
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          if (s3Object.ContentType) res.setHeader('Content-Type', s3Object.ContentType);
          const stream = s3Object.Body as any;
          if (stream && typeof stream.pipe === 'function') {
            return stream.pipe(res);
          } else if (stream && typeof stream.transformToByteArray === 'function') {
            const byteArray = await stream.transformToByteArray();
            return res.send(Buffer.from(byteArray));
          }
        } catch (_) {}
      }
    }

    const fetchRes = await fetch(rawUrl);
    if (!fetchRes.ok) {
      return res.status(fetchRes.status).send('Failed to fetch media');
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    const contentType = fetchRes.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    const arrayBuffer = await fetchRes.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error('Media proxy error:', error);
    return res.status(500).send('Proxy error');
  }
});

/**
 * POST /api/media/presigned-url
 * Get pre-signed upload URL for Cloudflare R2 (client-side direct upload)
 */
router.post('/presigned-url', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { filename, contentType } = req.body;
    if (!filename || !contentType) {
      return res.status(400).json({ error: 'Filename and contentType are required' });
    }

    const key = `uploads/${req.user!.id}/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const uploadUrl = await generateR2UploadUrl(key, contentType);
    const publicUrl = buildPublicUrl(req, key);

    return res.json({
      success: true,
      data: { uploadUrl, publicUrl, key },
    });
  } catch (error) {
    console.error('Presigned URL generation error:', error);
    return res.status(500).json({ error: 'Failed to generate presigned upload URL' });
  }
});

/**
 * POST /api/media/upload
 * Direct multipart file upload through backend to Cloudflare R2
 * Accepts multipart/form-data with field name "file"
 */
router.post('/upload', authenticateToken, upload.single('file'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided. Use multipart/form-data with field "file"' });
    }

    const { originalname, mimetype, buffer } = req.file;
    const safeName = originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `uploads/${req.user!.id}/${Date.now()}-${safeName}`;

    // Upload directly to R2
    await r2Client.send(new PutObjectCommand({
      Bucket: r2BucketName,
      Key: key,
      Body: buffer,
      ContentType: mimetype,
    }));

    const publicUrl = buildPublicUrl(req, key);

    return res.json({
      success: true,
      data: { publicUrl, key, filename: originalname, contentType: mimetype, size: buffer.length },
    });
  } catch (error) {
    console.error('Direct upload error:', error);
    return res.status(500).json({ error: 'Failed to upload file to storage' });
  }
});

/**
 * POST /api/media/upload-multiple
 * Upload multiple files at once (max 10)
 */
router.post('/upload-multiple', authenticateToken, upload.array('files', 10), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const results = await Promise.all(files.map(async (file) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const key = `uploads/${req.user!.id}/${Date.now()}-${safeName}`;

      await r2Client.send(new PutObjectCommand({
        Bucket: r2BucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }));

      const publicUrl = buildPublicUrl(req, key);

      return { publicUrl, key, filename: file.originalname, contentType: file.mimetype };
    }));

    return res.json({ success: true, data: results });
  } catch (error) {
    console.error('Multi-upload error:', error);
    return res.status(500).json({ error: 'Failed to upload files' });
  }
});

export default router;

