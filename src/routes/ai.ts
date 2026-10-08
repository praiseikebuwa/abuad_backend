import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { runCloudflareAI, runCloudflareAIVision, r2Client, r2BucketName } from '../config/cloudflare';
import { GetObjectCommand } from '@aws-sdk/client-s3';

const router = Router();

// Whitelist of allowed Cloudflare Workers AI models
const ALLOWED_MODELS = new Set([
  '@cf/meta/llama-3.1-8b-instruct',
  '@cf/meta/llama-3.2-3b-instruct',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-3.2-11b-vision-instruct',
  '@cf/mistral/mistral-7b-instruct-v0.2',
]);

const DEFAULT_SYSTEM_PROMPT = `You are the official ABUAD AI Assistant & Study Buddy for Afe Babalola University (ABUAD) students. Your role is to provide accurate, high-quality, and comprehensive explanations across all academic disciplines (Mathematics, Computer Science, Engineering, Sciences, Law, Medicine, Business) and campus life.

Key Instructions:
1. Domain Accuracy: Carefully analyze the user's domain. For mathematics questions (e.g., matrices, functions, calculus, algebra), provide pure mathematical definitions, properties, and LaTeX formulas. For programming questions, provide clear code snippets in the relevant language.
2. Structure & Clarity: Use GitHub-flavored Markdown, clear headings, bullet points, and LaTeX notation where applicable.
3. Tone: Be formal, academic, encouraging, clear, and direct.`;

async function getImageBuffer(imageUrl: string): Promise<Buffer | null> {
  try {
    let key: string | null = null;
    if (imageUrl.includes('/api/media/file/')) {
      key = imageUrl.split('/api/media/file/')[1];
    } else if (imageUrl.includes('uploads/')) {
      key = 'uploads/' + imageUrl.split('uploads/')[1];
    }

    if (key) {
      try {
        const command = new GetObjectCommand({
          Bucket: r2BucketName,
          Key: key,
        });
        const s3Object = await r2Client.send(command);
        const stream = s3Object.Body as any;
        if (stream && typeof stream.transformToByteArray === 'function') {
          const byteArray = await stream.transformToByteArray();
          return Buffer.from(byteArray);
        } else if (stream && typeof stream.pipe === 'function') {
          const chunks: Buffer[] = [];
          for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
          }
          return Buffer.concat(chunks);
        }
      } catch (r2Err) {
        console.warn('Could not fetch image directly from R2 key, falling back to fetch:', r2Err);
      }
    }

    if (imageUrl.startsWith('data:image')) {
      const base64Data = imageUrl.split(',')[1];
      if (base64Data) {
        return Buffer.from(base64Data, 'base64');
      }
    }

    const fetchRes = await fetch(imageUrl);
    if (fetchRes.ok) {
      const arrayBuffer = await fetchRes.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
  } catch (err) {
    console.error('Error in getImageBuffer:', err);
  }
  return null;
}

/**
 * POST /api/ai/query
 * Standard JSON endpoint for AI assistant queries
 */
router.post('/query', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { prompt, imageUrl, systemPrompt, model } = req.body;

    const activePrompt = (typeof prompt === 'string' && prompt.trim()) ? prompt.trim() : 'What is in this image?';

    if (activePrompt.length > 12000) {
      return res.status(400).json({
        success: false,
        error: { code: 'PROMPT_TOO_LONG', message: 'Prompt exceeds maximum character limit of 12,000' }
      });
    }

    const activeSystemPrompt = (typeof systemPrompt === 'string' && systemPrompt.trim())
      ? systemPrompt.trim()
      : DEFAULT_SYSTEM_PROMPT;

    let aiResult: any;

    if (typeof imageUrl === 'string' && imageUrl.trim()) {
      const imageBuffer = await getImageBuffer(imageUrl.trim());
      if (imageBuffer) {
        const visionPrompt = `${activeSystemPrompt}\n\nUser Question: ${activePrompt}`;
        const visionModel = '@cf/meta/llama-3.2-11b-vision-instruct';
        aiResult = await runCloudflareAIVision(visionPrompt, imageBuffer, visionModel);
      } else {
        return res.status(400).json({
          success: false,
          error: { code: 'IMAGE_FETCH_FAILED', message: 'Unable to retrieve image file for AI inspection.' }
        });
      }
    } else {
      const selectedModel = model && ALLOWED_MODELS.has(model)
        ? model
        : process.env.CLOUDFLARE_AI_MODEL || '@cf/meta/llama-3.1-8b-instruct';

      aiResult = await runCloudflareAI(activePrompt, selectedModel, {
        systemPrompt: activeSystemPrompt,
      });
    }

    let reply = '';
    if (aiResult?.result?.response && typeof aiResult.result.response === 'string') {
      reply = aiResult.result.response;
    } else if (aiResult?.result?.description && typeof aiResult.result.description === 'string') {
      reply = aiResult.result.description;
    } else if (aiResult?.response && typeof aiResult.response === 'string') {
      reply = aiResult.response;
    } else if (typeof aiResult?.result === 'string') {
      reply = aiResult.result;
    } else if (typeof aiResult === 'string') {
      reply = aiResult;
    }

    // If Cloudflare Workers AI returned empty result or connection error
    if (!reply || reply.trim() === '' || reply.trim() === '{}') {
      return res.status(503).json({
        success: false,
        error: {
          code: 'NETWORK_SERVICE_ERROR',
          message: 'AI Assistant is currently experiencing a connection issue. Please check your internet connection and try again.'
        }
      });
    }

    return res.json({
      success: true,
      data: { response: reply },
    });
  } catch (error) {
    console.error('AI query error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'AI_SERVICE_ERROR', message: 'AI Assistant network connection error. Please try again.' }
    });
  }
});

/**
 * POST /api/ai/stream
 * Real Server-Sent Events (SSE) streaming endpoint for AI response tokens
 */
router.post('/stream', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { prompt, systemPrompt, model } = req.body;

    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PROMPT', message: 'Prompt must be a non-empty string' }
      });
    }

    const selectedModel = model && ALLOWED_MODELS.has(model)
      ? model
      : process.env.CLOUDFLARE_AI_MODEL || '@cf/meta/llama-3.1-8b-instruct';

    const activeSystemPrompt = (typeof systemPrompt === 'string' && systemPrompt.trim())
      ? systemPrompt.trim()
      : DEFAULT_SYSTEM_PROMPT;

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const cloudflareRes = await runCloudflareAI(prompt.trim(), selectedModel, {
      systemPrompt: activeSystemPrompt,
      stream: true,
    });

    // Check if cloudflareRes is a Response stream from fetch
    if (cloudflareRes && typeof cloudflareRes === 'object' && cloudflareRes.body) {
      const reader = cloudflareRes.body.getReader?.();
      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
        }
        res.end();
        return;
      }
    }

    // Network connection error fallback if stream is unreachable
    res.write(`data: ${JSON.stringify({ response: 'AI Assistant connection error. Please check your internet connection.' })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('AI streaming error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: { code: 'AI_STREAM_ERROR', message: 'Streaming failed due to network connection error.' }
      });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'AI stream interrupted due to connection issue' })}\n\n`);
      res.end();
    }
  }
});

/**
 * POST /api/ai/moderate
 * Fail-closed text moderation endpoint
 */
router.post('/moderate', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { text, model } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.json({ success: true, safe: true, status: 'approved' });
    }

    const moderationPrompt = `You are a strict content moderation classifier.
Analyze if the following text is safe for a university community platform.
Check for extreme profanity, hate speech, harassment, explicit sexual content, threats of violence, or illegal acts.

Content to analyze:
"${text.replace(/"/g, '\\"')}"

Respond ONLY with a valid JSON object in this exact format with no additional text or markdown formatting:
{"safe": true} OR {"safe": false, "reason": "short explanation"}
`;

    const result = await runCloudflareAI(moderationPrompt, model);

    let aiText = '';
    if (result?.result?.response) {
      aiText = result.result.response;
    } else if (typeof result === 'string') {
      aiText = result;
    } else if (result?.result && typeof result.result === 'string') {
      aiText = result.result;
    }

    const cleanedText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();

    try {
      const parsed = JSON.parse(cleanedText);
      const isSafe = parsed.safe ?? false;
      return res.json({
        success: true,
        safe: isSafe,
        status: isSafe ? 'approved' : 'rejected',
        reason: parsed.reason,
      });
    } catch {
      const isUnsafe = /"safe":\s*false|unsafe|inappropriate|violation/i.test(cleanedText);
      return res.json({
        success: true,
        safe: !isUnsafe,
        status: !isUnsafe ? 'approved' : 'review',
        reason: isUnsafe ? 'Flagged for moderation review' : undefined,
      });
    }
  } catch (error) {
    console.error('Text moderation exception:', error);
    // FAIL-CLOSED: Flag for human review if AI moderation fails
    return res.json({
      success: false,
      safe: false,
      status: 'review',
      reason: 'Moderation service temporarily unavailable',
    });
  }
});

/**
 * POST /api/ai/moderate-image
 * Fail-closed image media moderation using Cloudflare Vision binary analysis
 */
router.post('/moderate-image', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.trim()) {
      return res.json({ success: true, safe: true, status: 'approved' });
    }

    // Fetch the actual image buffer to pass binary payload to Cloudflare Vision AI
    let imageBuffer: Buffer;
    try {
      const imageFetchRes = await fetch(imageUrl);
      if (!imageFetchRes.ok) {
        throw new Error(`Failed to fetch image HTTP ${imageFetchRes.status}`);
      }
      const arrayBuffer = await imageFetchRes.arrayBuffer();
      imageBuffer = Buffer.from(arrayBuffer);
    } catch (fetchErr) {
      console.error('Image fetch error for moderation:', fetchErr);
      // FAIL-CLOSED: If image cannot be retrieved for inspection, flag for review
      return res.json({
        success: false,
        safe: false,
        status: 'review',
        reason: 'Unable to retrieve image for safety inspection',
      });
    }

    const visionPrompt = `You are a strict image content moderation safety classifier.
Analyze if this image contains explicit adult content, extreme violence, illegal material, or hate symbols.

Respond ONLY with a valid JSON object in this exact format with no extra text:
{"safe": true} OR {"safe": false, "reason": "short description of violation"}`;

    const visionModel = '@cf/meta/llama-3.2-11b-vision-instruct';
    const result = await runCloudflareAIVision(visionPrompt, imageBuffer, visionModel);

    let aiText = '';
    if (result?.result?.response) {
      aiText = result.result.response;
    } else if (typeof result === 'string') {
      aiText = result;
    } else if (result?.result && typeof result.result === 'string') {
      aiText = result.result;
    }

    const cleanedText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();

    try {
      const parsed = JSON.parse(cleanedText);
      const isSafe = parsed.safe ?? false;
      return res.json({
        success: true,
        safe: isSafe,
        status: isSafe ? 'approved' : 'rejected',
        reason: parsed.reason,
      });
    } catch {
      const isUnsafe = /"safe":\s*false|unsafe|inappropriate|explicit|violation/i.test(cleanedText);
      return res.json({
        success: true,
        safe: !isUnsafe,
        status: !isUnsafe ? 'approved' : 'review',
        reason: isUnsafe ? 'Flagged for image safety review' : undefined,
      });
    }
  } catch (error) {
    console.error('Image moderation exception:', error);
    // FAIL-CLOSED: Flag for review on failure
    return res.json({
      success: false,
      safe: false,
      status: 'review',
      reason: 'Image moderation service temporarily unavailable',
    });
  }
});

export default router;


