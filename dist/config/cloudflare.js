"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.r2Client = exports.r2PublicDomain = exports.r2BucketName = void 0;
exports.generateR2UploadUrl = generateR2UploadUrl;
exports.runCloudflareAI = runCloudflareAI;
exports.runCloudflareAIVision = runCloudflareAIVision;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';
exports.r2BucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'abuad-media';
exports.r2PublicDomain = process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN || '';
// Configure AWS S3 Client targeting Cloudflare R2 endpoint
exports.r2Client = new client_s3_1.S3Client({
    region: 'auto',
    endpoint: accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined,
    credentials: {
        accessKeyId,
        secretAccessKey,
    },
    maxAttempts: 2,
});
/**
 * Generate a pre-signed upload URL for Cloudflare R2 storage
 */
async function generateR2UploadUrl(key, contentType, expiresInSeconds = 3600) {
    const command = new client_s3_1.PutObjectCommand({
        Bucket: exports.r2BucketName,
        Key: key,
        ContentType: contentType,
    });
    return (0, s3_request_presigner_1.getSignedUrl)(exports.r2Client, command, { expiresIn: expiresInSeconds });
}
/**
 * Helper to call Cloudflare Workers AI REST API endpoint
 */
async function runCloudflareAI(promptOrPayload, modelOverride, options) {
    const token = process.env.CLOUDFLARE_AI_API_TOKEN;
    const accountIdEnv = process.env.CLOUDFLARE_ACCOUNT_ID || accountId;
    const model = modelOverride || process.env.CLOUDFLARE_AI_MODEL || '@cf/meta/llama-3.1-8b-instruct';
    if (!token || !accountIdEnv) {
        const promptText = typeof promptOrPayload === 'string' ? promptOrPayload : JSON.stringify(promptOrPayload);
        const isModeration = promptText.includes('content moderation classifier');
        return {
            success: true,
            result: {
                response: isModeration
                    ? '{"safe": true}'
                    : `[Cloudflare Workers AI Response for prompt: "${promptText}"]`
            }
        };
    }
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountIdEnv}/ai/run/${model}`;
    let body;
    if (typeof promptOrPayload === 'string') {
        const messages = [];
        if (options?.systemPrompt && options.systemPrompt.trim()) {
            messages.push({ role: 'system', content: options.systemPrompt.trim() });
        }
        messages.push({ role: 'user', content: promptOrPayload });
        body = {
            messages,
            ...(options?.stream ? { stream: true } : {}),
        };
    }
    else {
        body = {
            ...promptOrPayload,
            ...(options?.stream ? { stream: true } : {}),
        };
    }
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (options?.stream) {
            return response; // Return raw fetch response for streaming piping
        }
        const json = await response.json();
        if (process.env.NODE_ENV === 'development') {
            console.log('Cloudflare AI response:', JSON.stringify(json));
        }
        return json;
    }
    catch (error) {
        console.error('Cloudflare Workers AI fetch exception:', error);
        return {
            success: false,
            result: {
                response: 'Unable to reach Cloudflare AI. Please try again.'
            }
        };
    }
}
/**
 * Helper to call Cloudflare Workers AI Vision Model with image buffer
 */
async function runCloudflareAIVision(prompt, imageBuffer, modelOverride) {
    const token = process.env.CLOUDFLARE_AI_API_TOKEN;
    const accountIdEnv = process.env.CLOUDFLARE_ACCOUNT_ID || accountId;
    const model = modelOverride || '@cf/meta/llama-3.2-11b-vision-instruct';
    if (!token || !accountIdEnv) {
        const isModeration = prompt.includes('content moderation') || prompt.includes('safety classifier');
        return {
            success: true,
            result: {
                response: isModeration
                    ? '{"safe": true}'
                    : `[Cloudflare Vision AI Response for prompt: "${prompt}"]`
            }
        };
    }
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountIdEnv}/ai/run/${model}`;
    // Convert Node Buffer to Uint8Array byte array required by Cloudflare Vision API
    const imageArray = Array.from(new Uint8Array(imageBuffer));
    const body = {
        prompt,
        image: imageArray,
    };
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        return await response.json();
    }
    catch (error) {
        console.error('Cloudflare Workers AI Vision exception:', error);
        return {
            success: false,
            error: 'Vision moderation service request failed'
        };
    }
}
