"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_BANNER_URL = exports.AI_AVATAR_URL = void 0;
exports.isUserVerified = isUserVerified;
exports.containsAiMention = containsAiMention;
exports.getOrCreateAiUser = getOrCreateAiUser;
exports.isContentInappropriate = isContentInappropriate;
exports.triggerAiPostReply = triggerAiPostReply;
exports.triggerAiCommentReply = triggerAiCommentReply;
exports.triggerAiDirectChatReply = triggerAiDirectChatReply;
exports.generateAndPublishAiPost = generateAndPublishAiPost;
exports.scheduleAiAutonomousPosting = scheduleAiAutonomousPosting;
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
exports.AI_AVATAR_URL = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80';
exports.AI_BANNER_URL = 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1200&q=80';
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
                avatarUrl: exports.AI_AVATAR_URL,
                bannerUrl: exports.AI_BANNER_URL,
                bio: 'Official AI Campus & Academic Assistant for Afe Babalola University (ABUAD). Send me a DM or tag @ai for instant answers and conversations!'
            }
        });
    }
    else if (!aiUser.avatarUrl || aiUser.avatarUrl.includes('dicebear') || !aiUser.bannerUrl || aiUser.avatarUrl !== exports.AI_AVATAR_URL) {
        aiUser = await db_1.prisma.user.update({
            where: { id: aiUser.id },
            data: {
                avatarUrl: exports.AI_AVATAR_URL,
                bannerUrl: exports.AI_BANNER_URL,
                isVerified: true,
                verificationType: 'GOLD',
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
/**
 * Handle AI Bot response when user chats directly with ABUAD AI in a direct message channel
 */
async function triggerAiDirectChatReply(channelId, userMessage, mediaUrl, userName) {
    try {
        const aiUser = await getOrCreateAiUser();
        // Fetch recent chat history in this channel for natural contextual conversation (last 6 messages)
        const recentMessages = await db_1.prisma.chatMessage.findMany({
            where: { channelId, isDeleted: false },
            orderBy: { createdAt: 'desc' },
            take: 6,
            select: { senderId: true, text: true, mediaUrl: true }
        });
        const history = recentMessages.reverse().map(m => {
            const sender = m.senderId === aiUser.id ? 'ABUAD AI' : (userName || 'Student');
            return `${sender}: ${m.text}`;
        }).join('\n');
        const conversationPrompt = `You are ABUAD AI, the intelligent, friendly, and helpful campus AI companion for Afe Babalola University (ABUAD).
You are having a direct 1-on-1 chat conversation with ${userName || 'a student'}.

CRITICAL INSTRUCTIONS FOR DIRECT CHAT:
1. Speak in a natural, casual, and friendly conversational tone — just like a smart student or mentor texting back.
2. Keep your replies SHORT and CONCISE (1 to 3 short sentences or a brief paragraph). Do NOT output long Wikipedia-style definitions, formal essays, or robotic bulleted lists unless explicitly asked.
3. If they say "hi", "how are you", "what's up", reply warmly and casually.
4. If an image is provided, comment on it directly.

Recent Chat History:
${history}

Student's Latest Message: "${userMessage || 'Hello'}"

Reply as ABUAD AI:`;
        const aiReply = await generateAiReply(conversationPrompt, mediaUrl, userMessage);
        // Save message from AI bot
        const createdMsg = await db_1.prisma.chatMessage.create({
            data: {
                senderId: aiUser.id,
                channelId,
                text: aiReply,
                type: 'text',
            },
            include: {
                sender: { select: { id: true, username: true, fullName: true, avatarUrl: true } }
            }
        });
        await db_1.prisma.chatChannel.update({
            where: { id: channelId },
            data: {
                lastMessage: aiReply,
                lastMessageTime: new Date(),
            }
        });
        // Mark prior messages in this channel as read by ABUAD AI
        const priorUnread = await db_1.prisma.chatMessage.findMany({
            where: { channelId, senderId: { not: aiUser.id } },
            select: { id: true, readBy: true }
        });
        for (const msg of priorUnread) {
            let rb = [];
            try {
                rb = JSON.parse(msg.readBy || '[]');
            }
            catch { }
            if (!rb.includes(aiUser.id)) {
                rb.push(aiUser.id);
                await db_1.prisma.chatMessage.update({
                    where: { id: msg.id },
                    data: { readBy: JSON.stringify(rb) }
                });
            }
        }
        return createdMsg;
    }
    catch (err) {
        console.error('Error in triggerAiDirectChatReply:', err);
    }
}
/**
 * High-quality verified Pexels themes for autonomous campus AI posts
 */
const PEXELS_CAMPUS_IMAGE_COLLECTIONS = {
    general: [
        'https://images.pexels.com/photos/1438072/pexels-photo-1438072.jpeg?auto=compress&cs=tinysrgb&w=1000',
        'https://images.pexels.com/photos/159775/library-la-trobe-study-students-159775.jpeg?auto=compress&cs=tinysrgb&w=1000',
        'https://images.pexels.com/photos/207692/pexels-photo-207692.jpeg?auto=compress&cs=tinysrgb&w=1000',
        'https://images.pexels.com/photos/267885/pexels-photo-267885.jpeg?auto=compress&cs=tinysrgb&w=1000',
    ],
    tech: [
        'https://images.pexels.com/photos/3184465/pexels-photo-3184465.jpeg?auto=compress&cs=tinysrgb&w=1000',
        'https://images.pexels.com/photos/1181675/pexels-photo-1181675.jpeg?auto=compress&cs=tinysrgb&w=1000',
        'https://images.pexels.com/photos/3861969/pexels-photo-3861969.jpeg?auto=compress&cs=tinysrgb&w=1000',
        'https://images.pexels.com/photos/546819/pexels-photo-546819.jpeg?auto=compress&cs=tinysrgb&w=1000',
    ],
    marketplace: [
        'https://images.pexels.com/photos/5632402/pexels-photo-5632402.jpeg?auto=compress&cs=tinysrgb&w=1000',
        'https://images.pexels.com/photos/3985062/pexels-photo-3985062.jpeg?auto=compress&cs=tinysrgb&w=1000',
        'https://images.pexels.com/photos/4068314/pexels-photo-4068314.jpeg?auto=compress&cs=tinysrgb&w=1000',
    ],
    wellness: [
        'https://images.pexels.com/photos/3768916/pexels-photo-3768916.jpeg?auto=compress&cs=tinysrgb&w=1000',
        'https://images.pexels.com/photos/3076509/pexels-photo-3076509.jpeg?auto=compress&cs=tinysrgb&w=1000',
        'https://images.pexels.com/photos/3771097/pexels-photo-3771097.jpeg?auto=compress&cs=tinysrgb&w=1000',
    ],
    science_med: [
        'https://images.pexels.com/photos/2280549/pexels-photo-2280549.jpeg?auto=compress&cs=tinysrgb&w=1000',
        'https://images.pexels.com/photos/3825586/pexels-photo-3825586.jpeg?auto=compress&cs=tinysrgb&w=1000',
    ],
};
/**
 * Dynamically synthesizes an autonomous campus post using Gemini AI & live media
 */
async function generateDynamicAiPostContent() {
    const geminiApiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    const topics = [
        'Study techniques, memory hacks, and exam readiness for university students (Engineering, Law, Medicine, Sciences)',
        'ABUAD AI feature highlight: reminding students they can tag @ai in any post or comment or DM @ai for study help',
        'Promoting the ABUAD student marketplace for buying and selling textbooks, electronics, gadgets, and room essentials',
        'Latest trends in AI, tech innovation, software development, and modern science relevant to university students',
        'Campus wellness, managing academic stress, mental clarity, and time management strategies',
        'Engaging campus poll or discussion starter asking students about their favorite campus study spots or habits',
    ];
    const selectedTopic = topics[Math.floor(Math.random() * topics.length)];
    if (geminiApiKey) {
        try {
            const ai = new genai_1.GoogleGenAI({ apiKey: geminiApiKey });
            const prompt = `You are ABUAD AI, the official student assistant for Afe Babalola University (ABUAD).
Generate an engaging, original, and beautifully formatted campus post about this topic: "${selectedTopic}".

Requirements:
1. Include a catchy headline with emojis (e.g. 💡 **ABUAD Study Insights**, 🚀 **Tech Spotlight**, 🛍️ **Marketplace Digest**).
2. Write 1 to 2 engaging, concise paragraphs with clean markdown.
3. Mention tagging @ai if relevant to the topic.
4. Add 3 to 4 hashtags at the end (including #ABUAD).
5. Output ONLY a valid JSON object matching this structure:
{
  "content": "Full markdown text of the post with headline, body, and hashtags",
  "channelId": "general | marketplace | events | tech | academic",
  "theme": "general | tech | marketplace | wellness | science_med",
  "useGeneratedArt": false,
  "artPrompt": "Short descriptive visual prompt if useGeneratedArt is true"
}`;
            const res = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
            });
            const text = res?.text?.trim() || '';
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                const theme = parsed.theme || 'general';
                const channelId = parsed.channelId || 'general';
                let mediaUrl = '';
                if (parsed.useGeneratedArt && parsed.artPrompt) {
                    mediaUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(parsed.artPrompt)}?width=1080&height=1080&nologo=true`;
                }
                else {
                    const pool = PEXELS_CAMPUS_IMAGE_COLLECTIONS[theme] || PEXELS_CAMPUS_IMAGE_COLLECTIONS.general;
                    mediaUrl = pool[Math.floor(Math.random() * pool.length)];
                }
                const tagsMatch = parsed.content.match(/#(\w+)/g) || ['#ABUAD', '#ABUADAI', '#CampusLife'];
                const cleanTags = tagsMatch.map((t) => t.replace('#', ''));
                return {
                    content: parsed.content,
                    channelId,
                    mediaUrl,
                    hashtags: JSON.stringify(cleanTags),
                };
            }
        }
        catch (err) {
            console.warn('Dynamic Gemini AI post generation failed, using dynamic fallback:', err);
        }
    }
    // Dynamic fallback generator
    const fallbackThemes = ['tech', 'marketplace', 'wellness', 'general'];
    const theme = fallbackThemes[Math.floor(Math.random() * fallbackThemes.length)];
    const pool = PEXELS_CAMPUS_IMAGE_COLLECTIONS[theme] || PEXELS_CAMPUS_IMAGE_COLLECTIONS.general;
    const mediaUrl = pool[Math.floor(Math.random() * pool.length)];
    let content = `💡 **ABUAD AI Daily Campus Byte**\n\nNeed quick summaries, code debugging, or study tips? You can tag @ai on any post or comment or chat with me directly in DMs!\n\nKeep striving for excellence, ABUADites! 🚀📚 #ABUAD #CampusTech #StudyTips #ABUADAI`;
    let channelId = 'general';
    let hashtags = JSON.stringify(['ABUAD', 'CampusTech', 'StudyTips', 'ABUADAI']);
    if (theme === 'marketplace') {
        content = `🛍️ **ABUAD Student Marketplace Spotlight**\n\nLooking to buy or sell laptops, room refrigerators, textbooks, or student services?\n\nExplore verified listings in the **Marketplace** tab right here on ABUAD Nest! Fast, secure, and campus-wide. 📦✨ #ABUADMarketplace #StudentAd #CampusTrade #ABUAD`;
        channelId = 'marketplace';
        hashtags = JSON.stringify(['ABUADMarketplace', 'StudentAd', 'CampusTrade', 'ABUAD']);
    }
    else if (theme === 'wellness') {
        content = `🌿 **Student Wellness & Productivity Reminder**\n\nRemember to take short movement breaks between long study sessions. Hydration and rest are just as essential to academic excellence as revision! 💪🧘‍♂️ #ABUADWellness #StudentCare #CampusLife`;
        channelId = 'general';
        hashtags = JSON.stringify(['ABUADWellness', 'StudentCare', 'CampusLife']);
    }
    return { content, channelId, mediaUrl, hashtags };
}
async function generateAndPublishAiPost(force = false) {
    try {
        const aiUser = await getOrCreateAiUser();
        // Check if AI posted in the last 12 hours (unless forced)
        if (!force) {
            const recentAiPost = await db_1.prisma.post.findFirst({
                where: { authorId: aiUser.id },
                orderBy: { createdAt: 'desc' },
            });
            if (recentAiPost) {
                const hoursSinceLastPost = (Date.now() - new Date(recentAiPost.createdAt).getTime()) / (1000 * 60 * 60);
                if (hoursSinceLastPost < 12) {
                    return null; // Not time yet
                }
            }
        }
        // Generate dynamic post content & media autonomously
        const dynamicPost = await generateDynamicAiPostContent();
        const post = await db_1.prisma.post.create({
            data: {
                authorId: aiUser.id,
                content: dynamicPost.content,
                channelId: dynamicPost.channelId,
                mediaUrl: dynamicPost.mediaUrl,
                mediaType: dynamicPost.mediaUrl ? 'image' : 'none',
                hashtags: dynamicPost.hashtags,
                status: 'active',
            },
            include: {
                author: {
                    select: {
                        id: true,
                        username: true,
                        fullName: true,
                        avatarUrl: true,
                        isVerified: true,
                        verificationType: true,
                    }
                }
            }
        });
        console.log(`🤖 ABUAD AI published a new autonomous dynamic post: (ID: ${post.id})`);
        return post;
    }
    catch (error) {
        console.error('Error publishing autonomous AI post:', error);
        return null;
    }
}
function scheduleAiAutonomousPosting() {
    // Check and potentially publish shortly after server start (after 3s)
    setTimeout(() => {
        generateAndPublishAiPost().catch(e => console.error('Initial AI post check failed:', e));
    }, 3000);
    // Check every 4 hours
    setInterval(() => {
        generateAndPublishAiPost().catch(e => console.error('Periodic AI post check failed:', e));
    }, 4 * 60 * 60 * 1000);
}
