import { Router, Response } from 'express';
import { authenticateToken, optionalAuth, AuthenticatedRequest } from '../middleware/auth';
import { prisma } from '../config/db';
import { isUserVerified, containsAiMention, triggerAiPostReply, triggerAiCommentReply, isContentInappropriate } from '../services/aiBotService';
import { getUserInterestProfile, scorePost, encodeCursor, decodeCursor } from '../services/recommendationService';

const router = Router();

/**
 * GET /api/posts - Discovery / For You Feed with Personalized Ranking & Cursor Pagination
 */
router.get('/', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Number(req.query.limit) || 15;
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
    const feedType = req.query.feed ? String(req.query.feed).toLowerCase() : 'foryou';
    const channel = req.query.channel ? String(req.query.channel).toLowerCase() : undefined;
    const userId = req.user?.id;

    const decodedCursor = decodeCursor(cursor);

    let channelFilter: any = {};
    if (channel && channel !== 'all') {
      if (channel === 'reels') {
        channelFilter = {
          OR: [
            { mediaType: 'video' },
            { mediaType: 'VIDEO' },
            { mediaUrl: { contains: '.mp4' } },
            { mediaUrl: { contains: '.mov' } },
            { mediaUrl: { contains: '.webm' } },
            { mediaUrl: { contains: '.m3u8' } },
            { mediaUrl: { contains: '/videos/' } },
            { hashtags: { contains: 'reel' } },
            { hashtags: { contains: 'video' } },
          ],
        };
      } else {
        channelFilter = {
          OR: [
            { channelId: { equals: channel } },
            { hashtags: { contains: channel } },
            { content: { contains: `#${channel}` } },
          ],
        };
      }
    }

    // 1. If Following feed requested
    if (feedType === 'following') {
      if (!userId) {
        return res.json({ success: true, data: [], nextCursor: null, hasMore: false });
      }
      const following = await prisma.follower.findMany({
        where: { followerId: userId },
        select: { followedId: true },
      });
      const followedIds = following.map(f => f.followedId);

      if (followedIds.length === 0) {
        return res.json({ success: true, data: [], nextCursor: null, hasMore: false });
      }

      const posts = await prisma.post.findMany({
        where: {
          authorId: { in: followedIds },
          status: 'active',
          ...channelFilter,
          ...(decodedCursor?.createdAt ? { createdAt: { lt: new Date(decodedCursor.createdAt) } } : {}),
        },
        take: limit + 1,
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

      const hasMore = posts.length > limit;
      const resultPosts = hasMore ? posts.slice(0, limit) : posts;

      const formatted = resultPosts.map(p => {
        const { likes, savedBy, _count, ...rest } = p;
        return {
          ...rest,
          commentsCount: _count.comments,
          likesCount: _count.likes,
          isLiked: likes.length > 0,
          isSaved: savedBy.length > 0,
        };
      });

      const lastPost = formatted[formatted.length - 1];
      const nextCursor = hasMore && lastPost ? encodeCursor({ id: lastPost.id, createdAt: lastPost.createdAt.toISOString() }) : null;

      return res.json({ success: true, data: formatted, nextCursor, hasMore });
    }

    // 2. Personalized "For You" / Discovery Feed
    const userProfile = await getUserInterestProfile(userId);

    // Fetch candidate posts (take a larger candidate batch to rank and score)
    const candidatePosts = await prisma.post.findMany({
      where: {
        status: 'active',
        ...channelFilter,
        ...(decodedCursor?.createdAt ? { createdAt: { lt: new Date(decodedCursor.createdAt) } } : {}),
      },
      take: Math.max(limit * 3, 45),
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

    // Score and rank candidates
    const scoredPosts = candidatePosts.map(p => {
      const score = scorePost(p, userProfile);
      return { post: p, score };
    });

    // Sort by recommendation score descending
    scoredPosts.sort((a, b) => b.score - a.score);

    const hasMore = scoredPosts.length > limit;
    const selected = (hasMore ? scoredPosts.slice(0, limit) : scoredPosts).map(s => s.post);

    const formatted = selected.map(p => {
      const { likes, savedBy, _count, ...rest } = p;
      return {
        ...rest,
        commentsCount: _count.comments,
        likesCount: _count.likes,
        isLiked: likes.length > 0,
        isSaved: savedBy.length > 0,
      };
    });

    const lastPost = formatted[formatted.length - 1];
    const nextCursor = hasMore && lastPost ? encodeCursor({ id: lastPost.id, createdAt: lastPost.createdAt.toISOString() }) : null;

    return res.json({ success: true, data: formatted, nextCursor, hasMore });
  } catch (error) {
    console.error('Error in feed recommendation handler:', error);
    return res.status(500).json({ error: 'Failed to fetch personalized feed' });
  }
});

/**
 * GET /api/posts/videos - Video/Reel posts with personalized recommendation ranking and cursor pagination
 */
router.get('/videos', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
    const userId = req.user?.id;
    const decodedCursor = decodeCursor(cursor);

    const userProfile = await getUserInterestProfile(userId);

    const candidatePosts = await prisma.post.findMany({
      where: {
        OR: [
          { mediaType: 'video' },
          { mediaType: 'VIDEO' },
          { mediaUrl: { contains: '.mp4' } },
          { mediaUrl: { contains: '.mov' } },
          { mediaUrl: { contains: '.webm' } },
          { mediaUrl: { contains: '.m3u8' } },
          { mediaUrl: { contains: '/videos/' } },
        ],
        status: 'active',
        ...(decodedCursor?.createdAt ? { createdAt: { lt: new Date(decodedCursor.createdAt) } } : {}),
      },
      take: Math.max(limit * 3, 50),
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          select: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true, verificationType: true },
        },
        likes: userId ? { where: { userId }, select: { id: true } } : false,
        savedBy: userId ? { where: { userId }, select: { id: true } } : false,
        _count: { select: { comments: true, likes: true } },
      },
    });

    // Score candidates with recommendation engine
    const scored = candidatePosts.map(p => {
      const score = scorePost(p, userProfile);
      return { post: p, score };
    });

    scored.sort((a, b) => b.score - a.score);

    const hasMore = scored.length > limit;
    const resultPosts = (hasMore ? scored.slice(0, limit) : scored).map(s => s.post);

    const formatted = resultPosts.map(p => {
      const { likes, savedBy, _count, ...rest } = p as any;
      return {
        ...rest,
        commentsCount: _count?.comments ?? 0,
        likesCount: _count?.likes ?? 0,
        isLiked: Array.isArray(likes) ? likes.length > 0 : false,
        isSaved: Array.isArray(savedBy) ? savedBy.length > 0 : false,
      };
    });

    const lastPost = formatted[formatted.length - 1];
    const nextCursor = hasMore && lastPost ? encodeCursor({ id: lastPost.id, createdAt: lastPost.createdAt.toISOString() }) : null;

    return res.json({ success: true, data: formatted, nextCursor, hasMore });
  } catch (error) {
    console.error('Error fetching video reels:', error);
    return res.status(500).json({ error: 'Failed to fetch video reels' });
  }
});

/**
 * GET /api/posts/following - Posts from followed users with cursor pagination
 */
router.get('/following', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const limit = Number(req.query.limit) || 20;
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
    const decodedCursor = decodeCursor(cursor);

    const following = await prisma.follower.findMany({
      where: { followerId: userId },
      select: { followedId: true },
    });
    const followedIds = following.map(f => f.followedId);

    if (followedIds.length === 0) {
      return res.json({ success: true, data: [], nextCursor: null, hasMore: false });
    }

    const posts = await prisma.post.findMany({
      where: {
        authorId: { in: followedIds },
        status: 'active',
        ...(decodedCursor?.createdAt ? { createdAt: { lt: new Date(decodedCursor.createdAt) } } : {}),
      },
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          select: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true, verificationType: true },
        },
        likes: { where: { userId }, select: { id: true } },
        savedBy: { where: { userId }, select: { id: true } },
        _count: { select: { comments: true, likes: true } },
      },
    });

    const hasMore = posts.length > limit;
    const resultPosts = hasMore ? posts.slice(0, limit) : posts;

    const formatted = resultPosts.map(p => {
      const { likes, savedBy, _count, ...rest } = p;
      return {
        ...rest,
        commentsCount: _count.comments,
        likesCount: _count.likes,
        isLiked: likes.length > 0,
        isSaved: savedBy.length > 0,
      };
    });

    const lastPost = formatted[formatted.length - 1];
    const nextCursor = hasMore && lastPost ? encodeCursor({ id: lastPost.id, createdAt: lastPost.createdAt.toISOString() }) : null;

    return res.json({ success: true, data: formatted, nextCursor, hasMore });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch following feed' });
  }
});

/**
 * GET /api/posts/user/:userId - Posts by a specific user
 */
router.get('/user/:userId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const posts = await prisma.post.findMany({
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
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch user posts' });
  }
});

/**
 * GET /api/posts/user/:userId/likes - Posts liked by a specific user
 */
router.get('/user/:userId/likes', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const targetUserId = String(req.params.userId);
    const postLikes = await prisma.postLike.findMany({
      where: { userId: targetUserId, post: { status: 'active' } },
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: {
        post: {
          include: {
            author: {
              select: {
                id: true, username: true, fullName: true,
                avatarUrl: true, isVerified: true, verificationType: true,
              },
            },
            likes: { where: { userId: currentUserId }, select: { id: true } },
            savedBy: { where: { userId: currentUserId }, select: { id: true } },
            _count: { select: { comments: true, likes: true } },
          },
        },
      },
    });

    const formatted = postLikes.map(pl => {
      const { likes, savedBy, _count, ...rest } = pl.post;
      return {
        ...rest,
        commentsCount: _count.comments,
        likesCount: _count.likes,
        isLiked: likes.length > 0,
        isSaved: savedBy.length > 0,
      };
    });

    return res.json({ success: true, data: formatted });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch user liked posts' });
  }
});

/**
 * GET /api/posts/user/:userId/replies - Replies and comments by a specific user
 */
router.get('/user/:userId/replies', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetUserId = String(req.params.userId);

    const comments = await prisma.postComment.findMany({
      where: { authorId: targetUserId, post: { status: 'active' } },
      take: 40,
      orderBy: { createdAt: 'desc' },
      include: {
        post: {
          select: {
            id: true,
            content: true,
            author: { select: { id: true, username: true, fullName: true } }
          }
        },
        author: {
          select: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true, verificationType: true }
        }
      }
    });

    const replies = await prisma.commentReply.findMany({
      where: { authorId: targetUserId, comment: { post: { status: 'active' } } },
      take: 40,
      orderBy: { createdAt: 'desc' },
      include: {
        comment: {
          select: {
            postId: true,
            content: true,
            author: { select: { id: true, username: true, fullName: true } }
          }
        },
        author: {
          select: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true, verificationType: true }
        }
      }
    });

    const combined = [
      ...comments.map(c => ({
        id: c.id,
        postId: c.postId,
        content: c.content,
        authorId: c.authorId,
        authorName: c.author.fullName || c.author.username,
        authorHandle: c.author.username,
        authorAvatarUrl: c.author.avatarUrl,
        authorIsVerified: c.author.isVerified,
        authorVerificationType: c.author.verificationType,
        postContent: c.post?.content || '',
        postAuthorName: c.post?.author?.fullName || c.post?.author?.username || 'User',
        timestamp: new Date(c.createdAt).getTime(),
        createdAt: c.createdAt.toISOString(),
      })),
      ...replies.map(r => ({
        id: r.id,
        postId: r.comment.postId,
        content: r.content,
        authorId: r.authorId,
        authorName: r.author.fullName || r.author.username,
        authorHandle: r.author.username,
        authorAvatarUrl: r.author.avatarUrl,
        authorIsVerified: r.author.isVerified,
        authorVerificationType: r.author.verificationType,
        postContent: r.comment?.content || '',
        postAuthorName: r.comment?.author?.fullName || r.comment?.author?.username || 'User',
        timestamp: new Date(r.createdAt).getTime(),
        createdAt: r.createdAt.toISOString(),
      })),
    ];

    combined.sort((a, b) => b.timestamp - a.timestamp);

    return res.json({ success: true, data: combined });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch user replies' });
  }
});

/**
 * GET /api/posts/user/:userId/media - Media posts by a specific user
 */
router.get('/user/:userId/media', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const targetUserId = String(req.params.userId);

    const posts = await prisma.post.findMany({
      where: {
        authorId: targetUserId,
        status: 'active',
        OR: [
          { mediaUrl: { not: '' } },
          { mediaType: { in: ['image', 'video', 'gif'] } },
        ],
      },
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          select: {
            id: true, username: true, fullName: true,
            avatarUrl: true, isVerified: true, verificationType: true,
          },
        },
        likes: { where: { userId: currentUserId }, select: { id: true } },
        savedBy: { where: { userId: currentUserId }, select: { id: true } },
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
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch user media' });
  }
});

/**
 * GET /api/posts/saved - Saved posts for current user
 */
router.get('/saved', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const saved = await prisma.savedPost.findMany({
      where: { userId, post: { status: 'active' } },
      include: {
        post: {
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
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = saved.map(s => {
      const { likes, savedBy, _count, ...rest } = s.post;
      return {
        ...rest,
        commentsCount: _count.comments,
        likesCount: _count.likes,
        isLiked: likes.length > 0,
        isSaved: true,
      };
    });

    return res.json({ success: true, data: formatted });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch saved posts' });
  }
});

/**
 * GET /api/posts/trending-tags - Aggregated trending hashtags and campus tags
 */
router.get('/trending-tags', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const recentPosts = await prisma.post.findMany({
      where: { status: 'active' },
      take: 200,
      orderBy: { createdAt: 'desc' },
      select: {
        content: true,
        hashtags: true,
        likesCount: true,
        commentsCount: true,
      },
    });

    const tagCounts: { [tag: string]: number } = {};

    for (const post of recentPosts) {
      if (post.hashtags) {
        try {
          const parsed = JSON.parse(post.hashtags);
          if (Array.isArray(parsed)) {
            for (const tag of parsed) {
              const cleaned = String(tag).trim().replace(/^#/, '');
              if (cleaned.length > 1) {
                const key = cleaned.toLowerCase();
                tagCounts[key] = (tagCounts[key] || 0) + 2 + Math.floor((post.likesCount + post.commentsCount) / 3);
              }
            }
          }
        } catch (_) {
          const parts = String(post.hashtags).split(/[,\s]+/);
          for (const p of parts) {
            const cleaned = p.trim().replace(/^#/, '');
            if (cleaned.length > 1) {
              const key = cleaned.toLowerCase();
              tagCounts[key] = (tagCounts[key] || 0) + 1;
            }
          }
        }
      }

      if (post.content) {
        const matches = post.content.match(/#([a-zA-Z0-9_]+)/g);
        if (matches) {
          for (const m of matches) {
            const cleaned = m.replace(/^#/, '');
            if (cleaned.length > 1) {
              const key = cleaned.toLowerCase();
              tagCounts[key] = (tagCounts[key] || 0) + 1 + Math.floor((post.likesCount + post.commentsCount) / 5);
            }
          }
        }
      }
    }

    const defaultTags = ['ABUAD', 'Trending', 'CampusLife', 'Tech', 'Engineering', 'Law', 'Medicine', 'Sports', 'Events', 'News'];
    for (const dt of defaultTags) {
      const key = dt.toLowerCase();
      if (!tagCounts[key]) {
        tagCounts[key] = 1;
      }
    }

    const sortedTags = Object.entries(tagCounts)
      .map(([tag, count]) => ({
        tag: `#${tag}`,
        name: tag,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    return res.json({ success: true, data: sortedTags });
  } catch (error) {
    console.error('Error fetching trending tags:', error);
    return res.status(500).json({ error: 'Failed to fetch trending tags' });
  }
});

/**
 * GET /api/posts/search?q= - Search posts by content, hashtag, or author
 */
router.get('/search', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    const userId = req.user?.id;

    if (!q) {
      return res.json({ success: true, data: [] });
    }

    const rawTag = q.replace(/^#/, '');
    const searchConditions: any[] = [
      { content: { contains: q } },
      { hashtags: { contains: q } },
      { author: { username: { contains: q } } },
      { author: { fullName: { contains: q } } },
    ];

    if (rawTag !== q && rawTag.length > 0) {
      searchConditions.push({ content: { contains: rawTag } });
      searchConditions.push({ hashtags: { contains: rawTag } });
    }

    const posts = await prisma.post.findMany({
      where: {
        status: 'active',
        OR: searchConditions,
      },
      take: 40,
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
            isVerified: true,
            verificationType: true,
          },
        },
        likes: userId ? { where: { userId }, select: { id: true } } : false,
        savedBy: userId ? { where: { userId }, select: { id: true } } : false,
        _count: { select: { comments: true, likes: true } },
      },
    });

    const formatted = posts.map(p => {
      const { likes, savedBy, _count, ...rest } = p;
      return {
        ...rest,
        commentsCount: _count?.comments ?? 0,
        likesCount: _count?.likes ?? 0,
        isLiked: Array.isArray(likes) ? likes.length > 0 : false,
        isSaved: Array.isArray(savedBy) ? savedBy.length > 0 : false,
      };
    });

    return res.json({ success: true, data: formatted });
  } catch (error) {
    console.error('Error searching posts:', error);
    return res.status(500).json({ error: 'Failed to search posts' });
  }
});

/**
 * GET /api/posts/:id - Single post
 */
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const postId = String(req.params.id);
    const post = await prisma.post.findUnique({
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
    if (!post) return res.status(404).json({ error: 'Post not found' });
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
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch post' });
  }
});

/**
 * POST /api/posts - Create post
 */
router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { content, mediaUrls, mediaUrl, mediaType, hashtags, mentions, visibility, channelId, isAnonymous, replyPermission, pollData } = req.body;
    if (!content && (!mediaUrls || mediaUrls.length === 0) && !mediaUrl) {
      return res.status(400).json({ error: 'Post must contain text content or media' });
    }

    const checkMod = isContentInappropriate(content || '');
    if (checkMod.flagged) {
      return res.status(400).json({ error: checkMod.reason });
    }

    const post = await prisma.post.create({
      data: {
        authorId: req.user!.id,
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

    if (containsAiMention(post.content)) {
      triggerAiPostReply(post.id, post.content, post.mediaUrl, post.author.fullName || post.author.username);
    }

    // Notify followers about the new post (if not anonymous)
    if (!post.isAnonymous) {
      const followers = await prisma.follower.findMany({
        where: { followedId: req.user!.id },
        select: { followerId: true },
      });

      const validFollowers = followers.filter(f => f.followerId && f.followerId !== req.user!.id);
      if (validFollowers.length > 0) {
        const authorName = post.author.fullName || post.author.username || 'Someone you follow';
        const previewText = (post.content || (post.mediaUrl ? 'shared a photo/video' : 'posted an update')).trim();
        const truncated = previewText.length > 60 ? previewText.slice(0, 57) + '...' : previewText;
        const notifData = validFollowers.map(f => ({
          userId: f.followerId,
          senderId: req.user!.id,
          title: 'New Post',
          body: `${authorName}: "${truncated}"`,
          type: 'followingPost',
          relatedId: post.id,
        }));
        await (prisma.notification.createMany as any)({
          data: notifData,
        }).catch(() => {});
      }
    }

    return res.status(201).json({ success: true, data: post });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create post' });
  }
});

/**
 * DELETE /api/posts/:id - Delete post
 */
router.delete('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const post = await prisma.post.findUnique({ where: { id: String(req.params.id) } });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.authorId !== req.user!.id && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Not authorized to delete this post' });
    }
    await prisma.post.delete({ where: { id: String(req.params.id) } });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete post' });
  }
});

/**
 * POST /api/posts/:id/like - Like or unlike post
 */
router.post('/:id/like', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const postId = String(req.params.id);
    const userId = req.user!.id;

    const existingLike = await prisma.postLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });

    if (existingLike) {
      await prisma.$transaction([
        prisma.postLike.delete({ where: { id: existingLike.id } }),
        prisma.post.update({ where: { id: postId }, data: { likesCount: { decrement: 1 } } }),
      ]);
      return res.json({ success: true, isLiked: false });
    } else {
      await prisma.$transaction([
        prisma.postLike.create({ data: { postId, userId } }),
        prisma.post.update({ where: { id: postId }, data: { likesCount: { increment: 1 } } }),
      ]);

      const post = await prisma.post.findUnique({ where: { id: postId }, select: { authorId: true } });
      if (post && post.authorId && post.authorId !== userId) {
        const liker = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true, username: true } });
        await (prisma.notification.create as any)({
          data: {
            userId: post.authorId,
            senderId: userId,
            title: 'New Like',
            body: `${liker?.fullName || liker?.username || 'Someone'} liked your post`,
            type: 'like',
            relatedId: postId,
          },
        }).catch(() => {});
      }

      return res.json({ success: true, isLiked: true });
    }
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update post like status' });
  }
});

/**
 * GET /api/posts/:id/is-liked - Check if post is liked by current user
 */
router.get('/:id/is-liked', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const existing = await prisma.postLike.findUnique({
      where: { postId_userId: { postId: String(req.params.id), userId: req.user!.id } },
    });
    return res.json({ success: true, isLiked: !!existing });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to check like status' });
  }
});

/**
 * POST /api/posts/:id/save - Save or unsave post
 */
router.post('/:id/save', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const postId = String(req.params.id);
    const userId = req.user!.id;

    const existing = await prisma.savedPost.findUnique({ where: { userId_postId: { userId, postId } } });
    if (existing) {
      await prisma.$transaction([
        prisma.savedPost.delete({ where: { id: existing.id } }),
        prisma.post.update({ where: { id: postId }, data: { savesCount: { decrement: 1 } } }),
      ]);
      return res.json({ success: true, isSaved: false });
    } else {
      await prisma.$transaction([
        prisma.savedPost.create({ data: { userId, postId } }),
        prisma.post.update({ where: { id: postId }, data: { savesCount: { increment: 1 } } }),
      ]);
      return res.json({ success: true, isSaved: true });
    }
  } catch (error) {
    return res.status(500).json({ error: 'Failed to save/unsave post' });
  }
});

/**
 * POST /api/posts/:id/repost - Repost a post
 */
router.post('/:id/repost', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const postId = String(req.params.id);
    const userId = req.user!.id;
    const { content } = req.body;

    const originalPost = await prisma.post.findUnique({
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

    const [createdRepost] = await prisma.$transaction([
      prisma.post.create({
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
      prisma.post.update({
        where: { id: postId },
        data: { repostCount: { increment: 1 } },
      }),
    ]);

    if (originalPost.authorId && originalPost.authorId !== userId) {
      const reposter = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true, username: true } });
      await (prisma.notification.create as any)({
        data: {
          userId: originalPost.authorId,
          senderId: userId,
          title: 'Post Reposted',
          body: `${reposter?.fullName || reposter?.username || 'Someone'} reposted your post`,
          type: 'repost',
          relatedId: postId,
        },
      }).catch(() => {});
    }

    return res.status(201).json({ success: true, data: createdRepost });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to repost' });
  }
});

/**
 * POST /api/posts/:id/share - Increment share count
 */
router.post('/:id/share', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await prisma.post.update({ where: { id: String(req.params.id) }, data: { sharesCount: { increment: 1 } } });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to record share' });
  }
});

/**
 * POST /api/posts/:id/view - Increment view count
 */
router.post('/:id/view', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await prisma.post.update({ where: { id: String(req.params.id) }, data: { viewsCount: { increment: 1 } } });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to record view' });
  }
});

/**
 * POST /api/posts/:id/watch - Track reel/video watch metrics and update view counts
 */
router.post('/:id/watch', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const postId = String(req.params.id);
    const { watchedMs, completed, replayCount } = req.body;

    await prisma.post.update({
      where: { id: postId },
      data: {
        viewsCount: { increment: (replayCount && Number(replayCount) > 0 ? Number(replayCount) + 1 : 1) },
      },
    }).catch(() => {});

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to record watch metrics' });
  }
});

/**
 * GET /api/posts/:id/comments - Get comments sorted by verification tier
 */
router.get('/:id/comments', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const comments = await prisma.postComment.findMany({
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

    const getWeight = (author: any) => {
      if (!author) return 0;
      const vType = String(author.verificationType || '').toUpperCase();
      if (vType === 'GOLD') return 3;
      if (vType === 'VIOLET') return 2;
      if (vType === 'BLUE' || author.isVerified) return 1;
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
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

/**
 * POST /api/posts/:id/comment - Add a comment
 */
router.post('/:id/comment', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { content, parentCommentId } = req.body;
    if (!content) return res.status(400).json({ error: 'Comment content is required' });

    const checkMod = isContentInappropriate(content);
    if (checkMod.flagged) {
      return res.status(400).json({ error: checkMod.reason });
    }

    if (parentCommentId) {
      // It's a reply
      const reply = await prisma.commentReply.create({
        data: {
          commentId: parentCommentId,
          authorId: req.user!.id,
          content,
        },
        include: {
          author: { select: { id: true, username: true, fullName: true, avatarUrl: true } },
        },
      });
      await prisma.postComment.update({
        where: { id: parentCommentId },
        data: { replyCount: { increment: 1 } },
      });

      if (containsAiMention(content)) {
        triggerAiCommentReply(String(req.params.id), content, parentCommentId, reply.author.fullName || reply.author.username);
      }

      return res.status(201).json({ success: true, data: reply });
    }

    const comment = await prisma.postComment.create({
      data: {
        postId: String(req.params.id),
        authorId: req.user!.id,
        content,
      },
      include: {
        author: { select: { id: true, username: true, fullName: true, avatarUrl: true } },
      },
    });
    await prisma.post.update({
      where: { id: String(req.params.id) },
      data: { commentsCount: { increment: 1 } },
    });

    if (containsAiMention(content)) {
      triggerAiCommentReply(String(req.params.id), content, undefined, comment.author.fullName || comment.author.username);
    }

    const targetPost = await prisma.post.findUnique({ where: { id: String(req.params.id) }, select: { authorId: true } });
    if (targetPost && targetPost.authorId && targetPost.authorId !== req.user!.id) {
      await (prisma.notification.create as any)({
        data: {
          userId: targetPost.authorId,
          senderId: req.user!.id,
          title: 'New Comment',
          body: `${comment.author.fullName || comment.author.username || 'Someone'} commented: "${content.length > 50 ? content.slice(0, 47) + '...' : content}"`,
          type: 'comment',
          relatedId: String(req.params.id),
        },
      }).catch(() => {});
    }

    return res.status(201).json({ success: true, data: comment });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to add comment' });
  }
});

/**
 * DELETE /api/posts/:id/comment/:commentId
 */
router.delete('/:id/comment/:commentId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const comment = await prisma.postComment.findUnique({ where: { id: String(req.params.commentId) } });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.authorId !== req.user!.id) return res.status(403).json({ error: 'Not authorized' });
    await prisma.postComment.delete({ where: { id: String(req.params.commentId) } });
    await prisma.post.update({ where: { id: String(req.params.id) }, data: { commentsCount: { decrement: 1 } } });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete comment' });
  }
});

/**
 * POST /api/posts/:id/poll-vote - Vote on a poll
 */
router.post('/:id/poll-vote', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { optionIndex } = req.body;
    const post = await prisma.post.findUnique({ where: { id: String(req.params.id) } });
    if (!post || !post.pollData) return res.status(404).json({ error: 'Poll not found' });

    let poll: any = {};
    try { poll = JSON.parse(post.pollData); } catch {}

    await prisma.post.update({ where: { id: String(req.params.id) }, data: { pollData: JSON.stringify(poll) } });
    return res.json({ success: true, data: poll });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to vote on poll' });
  }
});

/**
 * POST /api/posts/:id/watch - Track reel / video watch metrics and update view counts
 */
router.post('/:id/watch', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const postId = String(req.params.id);
    const { watchedMs, durationMs, completionRate, replayCount, completed, skippedQuickly, source } = req.body;

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, viewsCount: true, authorId: true, hashtags: true },
    });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Increment post views count
    const updated = await prisma.post.update({
      where: { id: postId },
      data: {
        viewsCount: { increment: 1 },
      },
      select: { id: true, viewsCount: true },
    });

    return res.json({
      success: true,
      viewsCount: updated.viewsCount,
      metrics: {
        watchedMs: watchedMs || durationMs || 0,
        completionRate: completionRate || 0,
        replayCount: replayCount || 0,
        completed: !!completed,
        skippedQuickly: !!skippedQuickly,
        source: source || 'reels',
      },
    });
  } catch (error) {
    console.error('Error tracking video watch metrics:', error);
    return res.status(500).json({ error: 'Failed to record watch metrics' });
  }
});

/**
 * POST /api/posts/:id/view - Increment post view count
 */
router.post('/:id/view', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const postId = String(req.params.id);
    const updated = await prisma.post.update({
      where: { id: postId },
      data: {
        viewsCount: { increment: 1 },
      },
      select: { id: true, viewsCount: true },
    });
    return res.json({ success: true, viewsCount: updated.viewsCount });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to increment view count' });
  }
});

export default router;


