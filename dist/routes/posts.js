"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const db_1 = require("../config/db");
const aiBotService_1 = require("../services/aiBotService");
const router = (0, express_1.Router)();
/**
 * GET /api/posts - Feed posts
 */
router.get('/', auth_1.authenticateToken, async (req, res) => {
    try {
        const limit = Number(req.query.limit) || 20;
        const page = Number(req.query.page) || 1;
        const skip = (page - 1) * limit;
        const userId = req.user.id;
        const posts = await db_1.prisma.post.findMany({
            take: limit,
            skip,
            where: { status: 'active' },
            orderBy: { createdAt: 'desc' },
            include: {
                author: {
                    select: {
                        id: true, username: true, fullName: true,
                        avatarUrl: true, isVerified: true, verificationType: true,
                    },
                },
                likes: { where: { userId }, select: { id: true } },
                savedBy: { where: { userId }, select: { id: true } },
                _count: { select: { comments: true, likes: true } },
            },
        });
        const formatted = posts.map(p => {
            const { likes, savedBy, _count, ...rest } = p;
            return {
                ...rest,
                commentsCount: _count.comments,
                likesCount: _count.likes,
                isLiked: likes.length > 0,
                isSaved: savedBy.length > 0,
            };
        });
        return res.json({ success: true, data: formatted });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch posts' });
    }
});
/**
 * GET /api/posts/videos - Video/Reel posts
 */
router.get('/videos', auth_1.authenticateToken, async (req, res) => {
    try {
        const limit = Number(req.query.limit) || 30;
        const posts = await db_1.prisma.post.findMany({
            where: { mediaType: 'video', status: 'active' },
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
                author: {
                    select: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true },
                },
            },
        });
        return res.json({ success: true, data: posts });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch video posts' });
    }
});
/**
 * GET /api/posts/following - Posts from followed users
 */
router.get('/following', auth_1.authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const limit = Number(req.query.limit) || 30;
        const following = await db_1.prisma.follower.findMany({
            where: { followerId: userId },
            select: { followedId: true },
        });
        const followedIds = following.map(f => f.followedId);
        if (followedIds.length === 0) {
            return res.json({ success: true, data: [] });
        }
        const posts = await db_1.prisma.post.findMany({
            where: { authorId: { in: followedIds }, status: 'active' },
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
                author: {
                    select: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true },
                },
                likes: { where: { userId }, select: { id: true } },
            },
        });
        return res.json({ success: true, data: posts.map(p => ({ ...p, isLiked: p.likes.length > 0, likes: undefined })) });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch following feed' });
    }
});
/**
 * GET /api/posts/user/:userId - Posts by a specific user
 */
router.get('/user/:userId', auth_1.authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const posts = await db_1.prisma.post.findMany({
            where: { authorId: String(req.params.userId), status: 'active' },
            take: 50,
            orderBy: { createdAt: 'desc' },
            include: {
                author: {
                    select: {
                        id: true, username: true, fullName: true,
                        avatarUrl: true, isVerified: true, verificationType: true,
                    },
                },
                likes: { where: { userId }, select: { id: true } },
                savedBy: { where: { userId }, select: { id: true } },
                _count: { select: { comments: true, likes: true } },
            },
        });
        const formatted = posts.map(p => {
            const { likes, savedBy, _count, ...rest } = p;
            return {
                ...rest,
                commentsCount: _count.comments,
                likesCount: _count.likes,
                isLiked: likes.length > 0,
                isSaved: savedBy.length > 0,
            };
        });
        return res.json({ success: true, data: formatted });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch user posts' });
    }
});
/**
 * GET /api/posts/saved - Saved posts for current user
 */
router.get('/saved', auth_1.authenticateToken, async (req, res) => {
    try {
        const saved = await db_1.prisma.savedPost.findMany({
            where: { userId: req.user.id },
            include: {
                post: {
                    include: {
                        author: { select: { id: true, username: true, fullName: true, avatarUrl: true } },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        return res.json({ success: true, data: saved.map(s => s.post) });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch saved posts' });
    }
});
/**
 * GET /api/posts/search?q= - Search posts by content or hashtag
 */
router.get('/search', auth_1.authenticateToken, async (req, res) => {
    try {
        const q = String(req.query.q || '');
        const posts = await db_1.prisma.post.findMany({
            where: {
                status: 'active',
                OR: [
                    { content: { contains: q } },
                    { hashtags: { contains: q } },
                ],
            },
            take: 30,
            orderBy: { createdAt: 'desc' },
            include: {
                author: { select: { id: true, username: true, fullName: true, avatarUrl: true } },
            },
        });
        return res.json({ success: true, data: posts });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to search posts' });
    }
});
/**
 * GET /api/posts/:id - Single post
 */
router.get('/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const postId = String(req.params.id);
        const post = await db_1.prisma.post.findUnique({
            where: { id: postId },
            include: {
                author: {
                    select: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true, verificationType: true },
                },
                likes: { where: { userId }, select: { id: true } },
                savedBy: { where: { userId }, select: { id: true } },
                _count: { select: { comments: true, likes: true } },
            },
        });
        if (!post)
            return res.status(404).json({ error: 'Post not found' });
        const { likes, savedBy, _count, ...rest } = post;
        return res.json({
            success: true,
            data: {
                ...rest,
                commentsCount: _count.comments,
                likesCount: _count.likes,
                isLiked: likes.length > 0,
                isSaved: savedBy.length > 0,
            },
        });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch post' });
    }
});
/**
 * POST /api/posts - Create post
 */
router.post('/', auth_1.authenticateToken, async (req, res) => {
    try {
        const { content, mediaUrls, mediaUrl, mediaType, hashtags, mentions, visibility, channelId, isAnonymous, replyPermission, pollData } = req.body;
        if (!content && (!mediaUrls || mediaUrls.length === 0) && !mediaUrl) {
            return res.status(400).json({ error: 'Post must contain text content or media' });
        }
        const checkMod = (0, aiBotService_1.isContentInappropriate)(content || '');
        if (checkMod.flagged) {
            return res.status(400).json({ error: checkMod.reason });
        }
        const post = await db_1.prisma.post.create({
            data: {
                authorId: req.user.id,
                content: content || '',
                mediaUrl: mediaUrl || (mediaUrls && mediaUrls[0]) || '',
                mediaType: mediaType || 'none',
                mediaUrls: JSON.stringify(mediaUrls || (mediaUrl ? [mediaUrl] : [])),
                hashtags: JSON.stringify(hashtags || []),
                mentions: JSON.stringify(mentions || []),
                visibility: visibility || 'everyone',
                channelId: channelId || 'general',
                isAnonymous: isAnonymous || false,
                replyPermission: replyPermission || 'everyone',
                pollData: pollData ? JSON.stringify(pollData) : null,
            },
            include: {
                author: {
                    select: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true },
                },
            },
        });
        if ((0, aiBotService_1.containsAiMention)(post.content)) {
            (0, aiBotService_1.triggerAiPostReply)(post.id, post.content, post.mediaUrl, post.author.fullName || post.author.username);
        }
        return res.status(201).json({ success: true, data: post });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to create post' });
    }
});
/**
 * DELETE /api/posts/:id - Delete post
 */
router.delete('/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const post = await db_1.prisma.post.findUnique({ where: { id: String(req.params.id) } });
        if (!post)
            return res.status(404).json({ error: 'Post not found' });
        if (post.authorId !== req.user.id && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Not authorized to delete this post' });
        }
        await db_1.prisma.post.delete({ where: { id: String(req.params.id) } });
        return res.json({ success: true });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to delete post' });
    }
});
/**
 * POST /api/posts/:id/like - Like or unlike post
 */
router.post('/:id/like', auth_1.authenticateToken, async (req, res) => {
    try {
        const postId = String(req.params.id);
        const userId = req.user.id;
        const existingLike = await db_1.prisma.postLike.findUnique({
            where: { postId_userId: { postId, userId } },
        });
        if (existingLike) {
            await db_1.prisma.$transaction([
                db_1.prisma.postLike.delete({ where: { id: existingLike.id } }),
                db_1.prisma.post.update({ where: { id: postId }, data: { likesCount: { decrement: 1 } } }),
            ]);
            return res.json({ success: true, isLiked: false });
        }
        else {
            await db_1.prisma.$transaction([
                db_1.prisma.postLike.create({ data: { postId, userId } }),
                db_1.prisma.post.update({ where: { id: postId }, data: { likesCount: { increment: 1 } } }),
            ]);
            return res.json({ success: true, isLiked: true });
        }
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to update post like status' });
    }
});
/**
 * GET /api/posts/:id/is-liked - Check if post is liked by current user
 */
router.get('/:id/is-liked', auth_1.authenticateToken, async (req, res) => {
    try {
        const existing = await db_1.prisma.postLike.findUnique({
            where: { postId_userId: { postId: String(req.params.id), userId: req.user.id } },
        });
        return res.json({ success: true, isLiked: !!existing });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to check like status' });
    }
});
/**
 * POST /api/posts/:id/save - Save or unsave post
 */
router.post('/:id/save', auth_1.authenticateToken, async (req, res) => {
    try {
        const postId = String(req.params.id);
        const userId = req.user.id;
        const existing = await db_1.prisma.savedPost.findUnique({ where: { userId_postId: { userId, postId } } });
        if (existing) {
            await db_1.prisma.$transaction([
                db_1.prisma.savedPost.delete({ where: { id: existing.id } }),
                db_1.prisma.post.update({ where: { id: postId }, data: { savesCount: { decrement: 1 } } }),
            ]);
            return res.json({ success: true, isSaved: false });
        }
        else {
            await db_1.prisma.$transaction([
                db_1.prisma.savedPost.create({ data: { userId, postId } }),
                db_1.prisma.post.update({ where: { id: postId }, data: { savesCount: { increment: 1 } } }),
            ]);
            return res.json({ success: true, isSaved: true });
        }
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to save/unsave post' });
    }
});
/**
 * POST /api/posts/:id/repost - Repost a post
 */
router.post('/:id/repost', auth_1.authenticateToken, async (req, res) => {
    try {
        const postId = String(req.params.id);
        const userId = req.user.id;
        const { content } = req.body;
        const originalPost = await db_1.prisma.post.findUnique({
            where: { id: postId },
            include: {
                author: {
                    select: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true },
                },
            },
        });
        if (!originalPost) {
            return res.status(404).json({ error: 'Original post not found' });
        }
        const repostPayload = {
            id: originalPost.id,
            author_id: originalPost.authorId,
            author_name: originalPost.author.fullName || originalPost.author.username,
            author_handle: originalPost.author.username,
            author_avatar_url: originalPost.author.avatarUrl,
            content: originalPost.content,
            media_url: originalPost.mediaUrl,
            media_type: originalPost.mediaType,
            timestamp: originalPost.createdAt.toISOString(),
            is_verified: originalPost.author.isVerified,
            is_anonymous: originalPost.isAnonymous,
        };
        const [createdRepost] = await db_1.prisma.$transaction([
            db_1.prisma.post.create({
                data: {
                    authorId: userId,
                    content: content || '',
                    channelId: originalPost.channelId,
                    repostData: JSON.stringify(repostPayload),
                },
                include: {
                    author: {
                        select: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true },
                    },
                },
            }),
            db_1.prisma.post.update({
                where: { id: postId },
                data: { repostCount: { increment: 1 } },
            }),
        ]);
        return res.status(201).json({ success: true, data: createdRepost });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to repost' });
    }
});
/**
 * POST /api/posts/:id/share - Increment share count
 */
router.post('/:id/share', auth_1.authenticateToken, async (req, res) => {
    try {
        await db_1.prisma.post.update({ where: { id: String(req.params.id) }, data: { sharesCount: { increment: 1 } } });
        return res.json({ success: true });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to record share' });
    }
});
/**
 * POST /api/posts/:id/view - Increment view count
 */
router.post('/:id/view', auth_1.authenticateToken, async (req, res) => {
    try {
        await db_1.prisma.post.update({ where: { id: String(req.params.id) }, data: { viewsCount: { increment: 1 } } });
        return res.json({ success: true });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to record view' });
    }
});
/**
 * POST /api/posts/:id/watch - Track reel/video watch metrics (no-op analytics)
 */
router.post('/:id/watch', auth_1.authenticateToken, async (_req, res) => {
    return res.json({ success: true });
});
/**
 * GET /api/posts/:id/comments - Get comments sorted by verification tier
 */
router.get('/:id/comments', auth_1.authenticateToken, async (req, res) => {
    try {
        const comments = await db_1.prisma.postComment.findMany({
            where: { postId: String(req.params.id) },
            take: 100,
            include: {
                author: {
                    select: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true, verificationType: true },
                },
                replies: {
                    take: 10,
                    include: {
                        author: { select: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true, verificationType: true } },
                    },
                },
            },
        });
        const getWeight = (author) => {
            if (!author)
                return 0;
            const vType = String(author.verificationType || '').toUpperCase();
            if (vType === 'GOLD')
                return 3;
            if (vType === 'VIOLET')
                return 2;
            if (vType === 'BLUE' || author.isVerified)
                return 1;
            return 0;
        };
        comments.sort((a, b) => {
            const weightA = getWeight(a.author);
            const weightB = getWeight(b.author);
            if (weightA !== weightB) {
                return weightB - weightA; // Gold (3) > Violet (2) > Blue (1) > None (0) at top
            }
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
        return res.json({ success: true, data: comments });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch comments' });
    }
});
/**
 * POST /api/posts/:id/comment - Add a comment
 */
router.post('/:id/comment', auth_1.authenticateToken, async (req, res) => {
    try {
        const { content, parentCommentId } = req.body;
        if (!content)
            return res.status(400).json({ error: 'Comment content is required' });
        const checkMod = (0, aiBotService_1.isContentInappropriate)(content);
        if (checkMod.flagged) {
            return res.status(400).json({ error: checkMod.reason });
        }
        if (parentCommentId) {
            // It's a reply
            const reply = await db_1.prisma.commentReply.create({
                data: {
                    commentId: parentCommentId,
                    authorId: req.user.id,
                    content,
                },
                include: {
                    author: { select: { id: true, username: true, fullName: true, avatarUrl: true } },
                },
            });
            await db_1.prisma.postComment.update({
                where: { id: parentCommentId },
                data: { replyCount: { increment: 1 } },
            });
            if ((0, aiBotService_1.containsAiMention)(content)) {
                (0, aiBotService_1.triggerAiCommentReply)(String(req.params.id), content, parentCommentId, reply.author.fullName || reply.author.username);
            }
            return res.status(201).json({ success: true, data: reply });
        }
        const comment = await db_1.prisma.postComment.create({
            data: {
                postId: String(req.params.id),
                authorId: req.user.id,
                content,
            },
            include: {
                author: { select: { id: true, username: true, fullName: true, avatarUrl: true } },
            },
        });
        await db_1.prisma.post.update({
            where: { id: String(req.params.id) },
            data: { commentsCount: { increment: 1 } },
        });
        if ((0, aiBotService_1.containsAiMention)(content)) {
            (0, aiBotService_1.triggerAiCommentReply)(String(req.params.id), content, undefined, comment.author.fullName || comment.author.username);
        }
        return res.status(201).json({ success: true, data: comment });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to add comment' });
    }
});
/**
 * DELETE /api/posts/:id/comment/:commentId
 */
router.delete('/:id/comment/:commentId', auth_1.authenticateToken, async (req, res) => {
    try {
        const comment = await db_1.prisma.postComment.findUnique({ where: { id: String(req.params.commentId) } });
        if (!comment)
            return res.status(404).json({ error: 'Comment not found' });
        if (comment.authorId !== req.user.id)
            return res.status(403).json({ error: 'Not authorized' });
        await db_1.prisma.postComment.delete({ where: { id: String(req.params.commentId) } });
        await db_1.prisma.post.update({ where: { id: String(req.params.id) }, data: { commentsCount: { decrement: 1 } } });
        return res.json({ success: true });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to delete comment' });
    }
});
/**
 * POST /api/posts/:id/poll-vote - Vote on a poll
 */
router.post('/:id/poll-vote', auth_1.authenticateToken, async (req, res) => {
    try {
        const { optionIndex } = req.body;
        const post = await db_1.prisma.post.findUnique({ where: { id: String(req.params.id) } });
        if (!post || !post.pollData)
            return res.status(404).json({ error: 'Poll not found' });
        let poll = {};
        try {
            poll = JSON.parse(post.pollData);
        }
        catch { }
        if (poll.options && poll.options[optionIndex]) {
            poll.options[optionIndex].votes = (poll.options[optionIndex].votes || 0) + 1;
            poll.totalVotes = (poll.totalVotes || 0) + 1;
        }
        await db_1.prisma.post.update({ where: { id: String(req.params.id) }, data: { pollData: JSON.stringify(poll) } });
        return res.json({ success: true, data: poll });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to vote on poll' });
    }
});
exports.default = router;
