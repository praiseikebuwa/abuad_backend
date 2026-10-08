"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isUserVerified = isUserVerified;
exports.containsAiMention = containsAiMention;
exports.getOrCreateAiUser = getOrCreateAiUser;
exports.isContentInappropriate = isContentInappropriate;
exports.triggerAiPostReply = triggerAiPostReply;
exports.triggerAiCommentReply = triggerAiCommentReply;
const db_1 = require("../config/db");
const cloudflare_1 = require("../config/cloudflare");
const genai_1 = require("@google/genai");
const client_s3_1 = require("@aws-sdk/client-s3");
/**
 * Check if user is verified (Blue badge, Gold badge, or Admin)
 */
function isUserVerified(user) {
    if (!user)
        return false;
    if (user.isVerified)
        return true;
    if (user.verificationType && user.verificationType !== 'NONE')
        return true;
    if (user.role === 'ADMIN')
        return true;
    return false;
}
/**
 * Check if string content mentions @ai or #ai
 */
function containsAiMention(text) {
    if (!text || typeof text !== 'string')
        return false;
    return /(@ai|#ai)\b/i.test(text);
}
/**
 * Retrieve or create the system ABUAD AI Bot User
 */
async function getOrCreateAiUser() {
    let aiUser = await db_1.prisma.user.findFirst({
        where: {
            OR: [
                { username: 'abuad_ai' },
                { email: 'ai@abuad.edu.ng' }
            ]
        }
    });
    if (!aiUser) {
        aiUser = await db_1.prisma.user.create({
            data: {
                username: 'abuad_ai',
                email: 'ai@abuad.edu.ng',
                fullName: 'ABUAD AI',
                passwordHash: '$2a$10$aiBotDummyHashForSecurityNoLoginAllowed1234567890',
                role: 'STAFF',
                isVerified: true,
                verificationType: 'GOLD',
                avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=abuad_ai',
                bio: 'Official AI Campus & Academic Assistant for Afe Babalola University (ABUAD). Tag @ai in your posts or comments for instant assistance!'
            }
        });
    }
    return aiUser;
}
/**
 * Helper to fetch binary buffer for attached post image if any
 */
async function getImageBuffer(imageUrl) {
    try {
        let key = null;
        if (imageUrl.includes('/api/media/file/')) {
            key = imageUrl.split('/api/media/file/')[1];
        }
        else if (imageUrl.includes('uploads/')) {
            key = 'uploads/' + imageUrl.split('uploads/')[1];
        }
        if (key) {
            try {
                const command = new client_s3_1.GetObjectCommand({
                    Bucket: cloudflare_1.r2BucketName,
                    Key: key,
                });
                const s3Object = await cloudflare_1.r2Client.send(command);
                const stream = s3Object.Body;
                if (stream && typeof stream.transformToByteArray === 'function') {
                    const byteArray = await stream.transformToByteArray();
                    return Buffer.from(byteArray);
                }
                else if (stream && typeof stream.pipe === 'function') {
                    const chunks = [];
                    for await (const chunk of stream) {
                        chunks.push(Buffer.from(chunk));
                    }
                    return Buffer.concat(chunks);
                }
            }
            catch (r2Err) {
                console.warn('R2 image fetch notice:', r2Err);
            }
        }
        if (imageUrl.startsWith('data:image')) {
            const base64Data = imageUrl.split(',')[1];
            if (base64Data)
                return Buffer.from(base64Data, 'base64');
        }
        const fetchRes = await fetch(imageUrl);
        if (fetchRes.ok) {
            const arrayBuffer = await fetchRes.arrayBuffer();
            return Buffer.from(arrayBuffer);
        }
    }
    catch (err) {
        console.error('Error in getImageBuffer for AI:', err);
    }
    return null;
}
/**
 * Check if content contains harmful or inappropriate topics
 */
function isContentInappropriate(text) {
    if (!text || typeof text !== 'string')
        return { flagged: false };
    const harmfulTerms = [
        'suicide', 'self harm', 'kill yourself', 'murder', 'bomb threat',
        'terrorist attack', 'hate speech', 'nude photo', 'pornography', 'child abuse',
        'illegal drugs sale', 'weapon distribution'
    ];
    const lower = text.toLowerCase();
    for (const term of harmfulTerms) {
        if (lower.includes(term)) {
            return {
                flagged: true,
                reason: `Content contains prohibited or unsafe topics ("${term}").`
            };
        }
    }
    return { flagged: false };
}
/**
 * Generate AI reply using Gemini API (gemini-2.0-flash) with Cloudflare AI fallback
 */
async function generateAiReply(promptText, imageUrl, rawUserQuery) {
    const systemPrompt = `You are ABUAD AI, the official intelligent AI Assistant for Afe Babalola University (ABUAD).
You are replying to a user on the ABUAD social platform.
You have FULL multimodal capabilities including computer vision to perceive, view, and analyze attached images, photos, logos, graphics, and screenshots, as well as image generation capabilities.
NEVER state or claim that you are a text-only AI or that you cannot view, analyze, or generate images.
If an image is attached to the post or comment, inspect it thoroughly, identify any logos (such as Instagram, Twitter/X, Facebook, WhatsApp, ABUAD, etc.), objects, text, or elements in the image, and answer the user's question directly, accurately, and helpfully.
Keep your response concise, clear, accurate, friendly, academic, and engaging (1 to 3 short paragraphs maximum).
Use clean markdown formatting and light emojis where helpful.`;
    // Check if prompt requests explicit image generation/creation
    let generatedImageMarkdown = '';
    const userTextForGen = rawUserQuery || promptText;
    const isExplicitImageGen = /\b(generate|create|draw|paint|make an image|make a picture|make a photo|render image|render a picture)\b/i.test(userTextForGen) &&
        !/\b(what is|describe|explain|who is|identify|which app|look at|in this image)\b/i.test(userTextForGen);
    if (isExplicitImageGen) {
        const cleanPrompt = userTextForGen
            .replace(/@ai|#ai/gi, '')
            .replace(/Post Author:[^\n]*/gi, '')
            .replace(/User Question\/Content:[^\n]*/gi, '')
            .replace(/Please reply as[^\n]*/gi, '')
            .replace(/\b(generate|create|draw|paint|make|render|an image|a picture|a photo|image of|picture of|photo of)\b/gi, '')
            .trim();
        const promptForGen = cleanPrompt.length > 2 ? cleanPrompt : 'creative campus artwork';
        const generatedUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(promptForGen)}?width=1024&height=1024&nologo=true`;
        generatedImageMarkdown = `\n\n![Generated Image](${generatedUrl})`;
    }
    // 1. Attempt using Gemini API if available
    const geminiApiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (geminiApiKey) {
        try {
            const ai = new genai_1.GoogleGenAI({ apiKey: geminiApiKey });
            const model = 'gemini-2.0-flash';
            const parts = [{ text: `${systemPrompt}\n\nUser Question & Context:\n${promptText}` }];
            if (imageUrl && imageUrl.trim()) {
                const imageBuf = await getImageBuffer(imageUrl.trim());
                if (imageBuf) {
                    let mimeType = 'image/jpeg';
                    const trimmedUrl = imageUrl.trim().toLowerCase();
                    if (trimmedUrl.endsWith('.png'))
                        mimeType = 'image/png';
                    else if (trimmedUrl.endsWith('.webp'))
                        mimeType = 'image/webp';
                    else if (trimmedUrl.endsWith('.gif'))
                        mimeType = 'image/gif';
                    parts.push({
                        inlineData: {
                            data: imageBuf.toString('base64'),
                            mimeType,
                        },
                    });
                }
            }
            const res = await ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts }],
            });
            if (res && res.text) {
                return res.text.trim() + generatedImageMarkdown;
            }
        }
        catch (gErr) {
            console.warn('Gemini API call failed, falling back to Cloudflare AI:', gErr);
        }
    }
    // 2. Fallback to Cloudflare AI / Vision
    try {
        if (imageUrl && imageUrl.trim()) {
            const imageBuffer = await getImageBuffer(imageUrl.trim());
            if (imageBuffer) {
                const visionPrompt = `${systemPrompt}\n\nUser Request: ${promptText}`;
                const result = await (0, cloudflare_1.runCloudflareAIVision)(visionPrompt, imageBuffer, '@cf/meta/llama-3.2-11b-vision-instruct');
                const replyText = result?.result?.response || result?.result?.description || result?.response || '';
                if (replyText && replyText.trim())
                    return replyText.trim() + generatedImageMarkdown;
            }
        }
        const result = await (0, cloudflare_1.runCloudflareAI)(promptText, '@cf/meta/llama-3.1-8b-instruct', {
            systemPrompt,
        });
        const replyText = result?.result?.response || result?.result?.description || result?.response || '';
        if (replyText && replyText.trim())
            return replyText.trim() + generatedImageMarkdown;
    }
    catch (cfErr) {
        console.error('Cloudflare AI fallback error:', cfErr);
    }
    return "Hello! I'm **ABUAD AI**, your campus assistant. I received your tag! How can I assist you further?" + generatedImageMarkdown;
}
/**
 * Handle AI Bot response when a user tags @ai in a Post
 */
async function triggerAiPostReply(postId, userContent, mediaUrl, authorName) {
    try {
        const aiUser = await getOrCreateAiUser();
        const cleanText = userContent.replace(/@ai|#ai/gi, '').trim();
        const prompt = `Post Author: ${authorName || 'User'}\nUser Question/Content: "${cleanText || 'Please examine this post.'}"\n\nPlease reply as ABUAD AI.`;
        const aiReply = await generateAiReply(prompt, mediaUrl, cleanText);
        await db_1.prisma.postComment.create({
            data: {
                postId,
                authorId: aiUser.id,
                content: `🤖 **ABUAD AI**\n\n${aiReply}`,
            }
        });
        await db_1.prisma.post.update({
            where: { id: postId },
            data: { commentsCount: { increment: 1 } },
        });
    }
    catch (err) {
        console.error('Error executing triggerAiPostReply:', err);
    }
}
/**
 * Handle AI Bot response when a user tags @ai in a Comment
 */
async function triggerAiCommentReply(postId, commentContent, parentCommentId, authorName) {
    try {
        const aiUser = await getOrCreateAiUser();
        const post = await db_1.prisma.post.findUnique({
            where: { id: postId },
            include: { author: { select: { fullName: true, username: true } } }
        });
        let contextText = `Original Post by ${post?.author.fullName || 'User'}: "${post?.content || ''}"\n`;
        if (parentCommentId) {
            const parentComment = await db_1.prisma.postComment.findUnique({
                where: { id: parentCommentId },
                include: { author: { select: { fullName: true } } }
            });
            if (parentComment) {
                contextText += `Parent Comment by ${parentComment.author.fullName}: "${parentComment.content}"\n`;
            }
        }
        const cleanComment = commentContent.replace(/@ai|#ai/gi, '').trim();
        contextText += `Comment by ${authorName || 'User'}: "${cleanComment || 'Hello @ai'}"\n`;
        contextText += `\nPlease reply directly to ${authorName || 'the user'}'s comment.`;
        const aiReply = await generateAiReply(contextText, post?.mediaUrl, cleanComment);
        if (parentCommentId) {
            await db_1.prisma.commentReply.create({
                data: {
                    commentId: parentCommentId,
                    authorId: aiUser.id,
                    content: `🤖 **ABUAD AI**\n\n${aiReply}`,
                }
            });
            await db_1.prisma.postComment.update({
                where: { id: parentCommentId },
                data: { replyCount: { increment: 1 } },
            });
        }
        else {
            await db_1.prisma.postComment.create({
                data: {
                    postId,
                    authorId: aiUser.id,
                    content: `🤖 **ABUAD AI**\n\n${aiReply}`,
                }
            });
            await db_1.prisma.post.update({
                where: { id: postId },
                data: { commentsCount: { increment: 1 } },
            });
        }
    }
    catch (err) {
        console.error('Error executing triggerAiCommentReply:', err);
    }
}
