import { Router, Response } from 'express';
import { authenticateToken, optionalAuth, AuthenticatedRequest } from '../middleware/auth';
import { prisma } from '../config/db';
import { getOrCreateAiUser, AI_AVATAR_URL, AI_BANNER_URL } from '../services/aiBotService';

const router = Router();

/**
 * GET /api/users - List all users (Admin/Authenticated)
 */
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      take: 100,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        bio: true,
        avatarUrl: true,
        bannerUrl: true,
        department: true,
        level: true,
        college: true,
        phoneNumber: true,
        role: true,
        isVerified: true,
        verificationType: true,
        isBlocked: true,
        followersCount: true,
        followingCount: true,
        status: true,
        lastSeen: true,
        streakCount: true,
        websiteUrl: true,
        facebookUrl: true,
        twitterUrl: true,
        instagramUrl: true,
        linkedinUrl: true,
        whatsappUrl: true,
        tiktokUrl: true,
        youtubeUrl: true,
        snapchatUrl: true,
        githubUrl: true,
        twitchUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return res.json({ success: true, data: users });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
});

const handlePeopleYouMayKnow = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const me = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { id: true, department: true, college: true, level: true, phoneNumber: true },
    });

    const myFollowings = await prisma.follower.findMany({
      where: { followerId: currentUserId },
      select: { followedId: true },
    });
    const excludedIds = new Set<string>(myFollowings.map(f => f.followedId));
    excludedIds.add(currentUserId);
    excludedIds.add('abuad_ai');

    const blocked = await prisma.blockedUser.findMany({
      where: {
        OR: [{ blockerId: currentUserId }, { blockedId: currentUserId }],
      },
      select: { blockerId: true, blockedId: true },
    });
    blocked.forEach(b => {
      excludedIds.add(b.blockerId);
      excludedIds.add(b.blockedId);
    });

    const candidates = await prisma.user.findMany({
      where: {
        id: { notIn: Array.from(excludedIds) },
        isBlocked: false,
      },
      take: 50,
      select: {
        id: true,
        username: true,
        fullName: true,
        bio: true,
        avatarUrl: true,
        bannerUrl: true,
        department: true,
        level: true,
        college: true,
        isVerified: true,
        verificationType: true,
        followersCount: true,
        followingCount: true,
        createdAt: true,
        followers: {
          select: { followerId: true },
        },
      },
    });

    const myFollowingList = myFollowings.map(f => f.followedId);

    const scoredUsers = candidates.map(user => {
      let score = 0;
      let reason = 'Suggested for you';

      // Mutual connections
      const mutuals = user.followers.filter(f => myFollowingList.includes(f.followerId));
      const mutualCount = mutuals.length;

      if (mutualCount > 0) {
        score += mutualCount * 30;
        reason = mutualCount === 1 ? '1 mutual connection' : `${mutualCount} mutual connections`;
      } else if (me?.department && user.department && user.department.toLowerCase() === me.department.toLowerCase()) {
        score += 25;
        reason = `Same department • ${user.department}`;
      } else if (me?.college && user.college && user.college.toLowerCase() === me.college.toLowerCase()) {
        score += 15;
        reason = `From ${user.college}`;
      } else if (me?.level && user.level && user.level === me.level) {
        score += 10;
        reason = `${user.level} Level peer`;
      } else if (user.followersCount > 10) {
        score += Math.min(user.followersCount, 20);
        reason = 'Popular in ABUAD';
      } else if (user.isVerified) {
        score += 8;
        reason = 'Verified campus profile';
      }

      return {
        id: user.id,
        uid: user.id,
        username: user.username,
        handle: user.username,
        fullName: user.fullName,
        displayName: user.fullName,
        bio: user.bio,
        avatarUrl: user.avatarUrl,
        bannerUrl: user.bannerUrl,
        department: user.department,
        level: user.level,
        college: user.college,
        isVerified: user.isVerified,
        verificationType: user.verificationType,
        followersCount: user.followersCount,
        followingCount: user.followingCount,
        mutualCount,
        reason,
        score,
      };
    });

    scoredUsers.sort((a, b) => b.score - a.score);

    return res.json({
      success: true,
      data: scoredUsers.slice(0, 20),
    });
  } catch (error) {
    console.error('Error fetching people you may know:', error);
    return res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
};

/**
 * GET /api/users/people-you-may-know - Smart recommendation algorithm
 */
router.get('/people-you-may-know', authenticateToken, handlePeopleYouMayKnow);

/**
 * GET /api/users/suggestions - Alias
 */
router.get('/suggestions', authenticateToken, handlePeopleYouMayKnow);

/**
 * GET /api/users/me - Current authenticated user's profile
 */
router.get('/me', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        bio: true,
        avatarUrl: true,
        bannerUrl: true,
        department: true,
        level: true,
        college: true,
        phoneNumber: true,
        role: true,
        isVerified: true,
        verificationType: true,
        followersCount: true,
        followingCount: true,
        status: true,
        lastSeen: true,
        websiteUrl: true,
        createdAt: true,
      },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ success: true, data: user });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

/**
 * PUT /api/users/me - Update current user profile
 */
router.put('/me', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      fullName, display_name, bio, avatarUrl, avatar_url, bannerUrl, banner_url, department, level, college,
      phoneNumber, phone_number, websiteUrl, website_url, facebookUrl, facebook_url, twitterUrl, twitter_url,
      instagramUrl, instagram_url, linkedinUrl, linkedin_url, whatsappUrl, whatsapp_url, tiktokUrl, tiktok_url, youtubeUrl, youtube_url,
      snapchatUrl, snapchat_url, githubUrl, github_url, twitchUrl, twitch_url,
    } = req.body;

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(fullName !== undefined && { fullName }),
        ...(display_name !== undefined && { fullName: display_name }),
        ...(bio !== undefined && { bio }),
        ...(avatarUrl !== undefined && { avatarUrl }),
        ...(avatar_url !== undefined && { avatarUrl: avatar_url }),
        ...(bannerUrl !== undefined && { bannerUrl }),
        ...(banner_url !== undefined && { bannerUrl: banner_url }),
        ...(department !== undefined && { department }),
        ...(level !== undefined && { level }),
        ...(college !== undefined && { college }),
        ...(phoneNumber !== undefined && { phoneNumber }),
        ...(phone_number !== undefined && { phoneNumber: phone_number }),
        ...(websiteUrl !== undefined && { websiteUrl }),
        ...(website_url !== undefined && { websiteUrl: website_url }),
        ...(facebookUrl !== undefined && { facebookUrl }),
        ...(facebook_url !== undefined && { facebookUrl: facebook_url }),
        ...(twitterUrl !== undefined && { twitterUrl }),
        ...(twitter_url !== undefined && { twitterUrl: twitter_url }),
        ...(instagramUrl !== undefined && { instagramUrl }),
        ...(instagram_url !== undefined && { instagramUrl: instagram_url }),
        ...(linkedinUrl !== undefined && { linkedinUrl }),
        ...(linkedin_url !== undefined && { linkedinUrl: linkedin_url }),
        ...(whatsappUrl !== undefined && { whatsappUrl }),
        ...(whatsapp_url !== undefined && { whatsappUrl: whatsapp_url }),
        ...(tiktokUrl !== undefined && { tiktokUrl }),
        ...(tiktok_url !== undefined && { tiktokUrl: tiktok_url }),
        ...(youtubeUrl !== undefined && { youtubeUrl }),
        ...(youtube_url !== undefined && { youtubeUrl: youtube_url }),
        ...(snapchatUrl !== undefined && { snapchatUrl }),
        ...(snapchat_url !== undefined && { snapchatUrl: snapchat_url }),
        ...(githubUrl !== undefined && { githubUrl }),
        ...(github_url !== undefined && { githubUrl: github_url }),
        ...(twitchUrl !== undefined && { twitchUrl }),
        ...(twitch_url !== undefined && { twitchUrl: twitch_url }),
      },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        bio: true,
        avatarUrl: true,
        bannerUrl: true,
        department: true,
        college: true,
        phoneNumber: true,
        level: true,
        role: true,
        isVerified: true,
      },
    });
    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Profile update error:', error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * GET /api/users/search?q=
 */
router.get('/search', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rawQuery = String(req.query.q || '').trim();
    const cleanQuery = rawQuery.replace(/^@/, '');

    const whereClause: any = {
      isBlocked: false,
    };

    if (cleanQuery) {
      whereClause.OR = [
        { username: { contains: cleanQuery } },
        { fullName: { contains: cleanQuery } },
        { email: { contains: cleanQuery } },
        { department: { contains: cleanQuery } },
        { bio: { contains: cleanQuery } },
      ];
    }

    const users = await prisma.user.findMany({
      where: whereClause,
      take: 40,
      orderBy: cleanQuery
        ? [{ followersCount: 'desc' }, { createdAt: 'desc' }]
        : [{ followersCount: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        avatarUrl: true,
        bannerUrl: true,
        bio: true,
        department: true,
        level: true,
        college: true,
        isVerified: true,
        verificationType: true,
        followersCount: true,
        followingCount: true,
        status: true,
      },
    });

    const mapped = users.map(u => ({
      ...u,
      uid: u.id,
      displayName: u.fullName,
      handle: u.username,
    }));

    return res.json({ success: true, data: mapped });
  } catch (error) {
    console.error('Error searching users:', error);
    return res.status(500).json({ error: 'Failed to search users' });
  }
});

/**
 * GET /api/users/:id/followers
 */
router.get('/:id/followers', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    let targetId = req.params.id === 'me' ? req.user!.id : String(req.params.id);
    if (targetId === 'abuad_ai' || targetId.toLowerCase() === 'ai' || targetId === 'ai_bot') {
      const ai = await getOrCreateAiUser();
      targetId = ai.id;
    }
    const followers = await prisma.follower.findMany({
      where: { followedId: targetId },
      include: {
        follower: {
          select: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true },
        },
      },
      take: 100,
    });
    return res.json({ success: true, data: followers.map(f => f.follower) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch followers' });
  }
});

/**
 * GET /api/users/:id/following
 */
router.get('/:id/following', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    let targetId = req.params.id === 'me' ? req.user!.id : String(req.params.id);
    if (targetId === 'abuad_ai' || targetId.toLowerCase() === 'ai' || targetId === 'ai_bot') {
      const ai = await getOrCreateAiUser();
      targetId = ai.id;
    }
    const following = await prisma.follower.findMany({
      where: { followerId: targetId },
      include: {
        followed: {
          select: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true },
        },
      },
      take: 100,
    });
    return res.json({ success: true, data: following.map(f => f.followed) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch following' });
  }
});

/**
 * POST /api/users/:id/follow - Follow a user
 */
router.post('/:id/follow', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const followerId = req.user!.id;
    let followedId = String(req.params.id);
    if (followedId === 'abuad_ai' || followedId.toLowerCase() === 'ai' || followedId === 'ai_bot') {
      const ai = await getOrCreateAiUser();
      followedId = ai.id;
    }

    if (followerId === followedId) {
      return res.status(400).json({ error: 'Cannot follow yourself' });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: followedId } });
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existing = await prisma.follower.findUnique({
      where: { followerId_followedId: { followerId, followedId } },
    });

    if (existing) {
      return res.status(200).json({ success: true, isFollowing: true, message: 'Already following' });
    }

    await prisma.$transaction([
      prisma.follower.create({ data: { followerId, followedId } }),
      prisma.user.update({ where: { id: followerId }, data: { followingCount: { increment: 1 } } }),
      prisma.user.update({ where: { id: followedId }, data: { followersCount: { increment: 1 } } }),
    ]);

    return res.status(200).json({ success: true, isFollowing: true });
  } catch (error) {
    console.error('Follow error:', error);
    return res.status(500).json({ error: 'Failed to follow user' });
  }
});

/**
 * DELETE /api/users/:id/follow - Unfollow a user
 */
router.delete('/:id/follow', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const followerId = req.user!.id;
    let followedId = String(req.params.id);
    if (followedId === 'abuad_ai' || followedId.toLowerCase() === 'ai' || followedId === 'ai_bot') {
      const ai = await getOrCreateAiUser();
      followedId = ai.id;
    }

    const existing = await prisma.follower.findUnique({
      where: { followerId_followedId: { followerId, followedId } },
    });

    if (!existing) {
      return res.status(200).json({ success: true, isFollowing: false, message: 'Not currently following' });
    }

    await prisma.$transaction([
      prisma.follower.delete({ where: { id: existing.id } }),
      prisma.user.update({ where: { id: followerId }, data: { followingCount: { decrement: 1 } } }),
      prisma.user.update({ where: { id: followedId }, data: { followersCount: { decrement: 1 } } }),
    ]);

    return res.json({ success: true, isFollowing: false });
  } catch (error) {
    console.error('Unfollow error:', error);
    return res.status(500).json({ error: 'Failed to unfollow user' });
  }
});

/**
 * GET /api/users/:id/is-following - Check if following a user
 */
router.get('/:id/is-following', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    let targetId = String(req.params.id);
    if (targetId === 'abuad_ai' || targetId.toLowerCase() === 'ai' || targetId === 'ai_bot') {
      const ai = await getOrCreateAiUser();
      targetId = ai.id;
    }
    const existing = await prisma.follower.findUnique({
      where: { followerId_followedId: { followerId: req.user!.id, followedId: targetId } },
    });
    return res.json({ success: true, isFollowing: !!existing });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to check follow status' });
  }
});

/**
 * PUT /api/users/:id/status - Update user online status
 */
router.put('/:id/status', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status } = req.body;
    await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        status: status || 'online',
        lastSeen: new Date(),
      },
    });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update status' });
  }
});

/**
 * POST /api/users/block/:id - Block a user
 */
router.post('/block/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const blockerId = req.user!.id;
    const blockedId = String(req.params.id);

    const existing = await prisma.blockedUser.findUnique({
      where: { blockerId_blockedId: { blockerId, blockedId } },
    });
    if (!existing) {
      await prisma.blockedUser.create({ data: { blockerId, blockedId } });
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to block user' });
  }
});

/**
 * DELETE /api/users/block/:id - Unblock a user
 */
router.delete('/block/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const blockerId = req.user!.id;
    const blockedId = String(req.params.id);

    await prisma.blockedUser.deleteMany({ where: { blockerId, blockedId } });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to unblock user' });
  }
});

/**
 * GET /api/users/profile/:id - Profile endpoint alias
 */
router.get('/profile/:id', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  const targetId = String(req.params.id);
  const currentUserId = req.user?.id;

  try {
    if (targetId === 'abuad_ai' || targetId.toLowerCase() === 'ai' || targetId === 'ai_bot') {
      const aiUser = await getOrCreateAiUser();
      const realFollowersCount = await prisma.follower.count({ where: { followedId: aiUser.id } });
      const realFollowingCount = await prisma.follower.count({ where: { followerId: aiUser.id } });
      const isFollowing = currentUserId
        ? await prisma.follower.findUnique({
            where: {
              followerId_followedId: {
                followerId: currentUserId,
                followedId: aiUser.id,
              },
            },
          })
        : null;

      return res.json({
        success: true,
        data: {
          ...aiUser,
          displayName: aiUser.fullName,
          handle: aiUser.username,
          department: aiUser.department || 'Artificial Intelligence',
          college: aiUser.college || 'Computing & Engineering',
          followersCount: Math.max(aiUser.followersCount, realFollowersCount),
          followingCount: realFollowingCount,
          isFollowing: !!isFollowing,
          status: 'online',
        },
      });
    }

    let user: any = await prisma.user.findUnique({
      where: { id: targetId },
      include: {
        _count: {
          select: { followers: true, following: true, posts: true },
        },
      },
    });

    if (!user) {
      user = await prisma.user.findUnique({
        where: { username: targetId },
        include: {
          _count: {
            select: { followers: true, following: true, posts: true },
          },
        },
      });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let isFollowing = false;
    if (currentUserId && currentUserId !== user.id) {
      const followRecord = await prisma.follower.findUnique({
        where: {
          followerId_followedId: {
            followerId: currentUserId,
            followedId: user.id,
          },
        },
      });
      isFollowing = !!followRecord;
    }

    return res.json({
      success: true,
      data: {
        ...user,
        displayName: user.fullName,
        handle: user.username,
        followersCount: user._count?.followers ?? user.followersCount ?? 0,
        followingCount: user._count?.following ?? user.followingCount ?? 0,
        isFollowing,
      },
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

/**
 * ALL /api/users/:id - Get or update user attributes (verification, status, etc.)
 */
router.all('/:id', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  const targetId = String(req.params.id);
  const currentUserId = req.user?.id;

  if (req.method === 'GET') {
    try {
      if (targetId === 'abuad_ai' || targetId.toLowerCase() === 'ai' || targetId === 'ai_bot') {
        const aiUser = await getOrCreateAiUser();
        const realFollowersCount = await prisma.follower.count({ where: { followedId: aiUser.id } });
        const realFollowingCount = await prisma.follower.count({ where: { followerId: aiUser.id } });
        const isFollowing = currentUserId
          ? await prisma.follower.findUnique({
              where: {
                followerId_followedId: {
                  followerId: currentUserId,
                  followedId: aiUser.id,
                },
              },
            })
          : null;

        return res.json({
          success: true,
          data: {
            ...aiUser,
            displayName: aiUser.fullName,
            handle: aiUser.username,
            department: aiUser.department || 'Artificial Intelligence',
            college: aiUser.college || 'Computing & Engineering',
            followersCount: Math.max(aiUser.followersCount, realFollowersCount),
            followingCount: realFollowingCount,
            isFollowing: !!isFollowing,
            status: 'online',
          },
        });
      }

      let user: any = await prisma.user.findUnique({
        where: { id: targetId },
        include: {
          _count: {
            select: { followers: true, following: true, posts: true },
          },
        },
      });

      if (!user) {
        user = await prisma.user.findUnique({
          where: { username: targetId },
          include: {
            _count: {
              select: { followers: true, following: true, posts: true },
            },
          },
        });
      }

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      let isFollowing = false;
      if (currentUserId && currentUserId !== user.id) {
        const followRecord = await prisma.follower.findUnique({
          where: {
            followerId_followedId: {
              followerId: currentUserId,
              followedId: user.id,
            },
          },
        });
        isFollowing = !!followRecord;
      }

      return res.json({
        success: true,
        data: {
          ...user,
          displayName: user.fullName,
          handle: user.username,
          followersCount: user._count?.followers ?? user.followersCount ?? 0,
          followingCount: user._count?.following ?? user.followingCount ?? 0,
          isFollowing,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch user' });
    }
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    try {
      const {
        verification_type, verificationType, is_verified, isVerified, status,
      } = req.body;

      const updateData: any = {};

      if (verification_type !== undefined || verificationType !== undefined || is_verified !== undefined || isVerified !== undefined) {
        const rawType = (verification_type || verificationType || (is_verified || isVerified ? 'blue' : 'none')).toString().toLowerCase();
        updateData.isVerified = rawType !== 'none';
        updateData.verificationType = rawType.toUpperCase();
      }

      if (status !== undefined) {
        updateData.status = status;
        if (status === 'banned') {
          updateData.isBlocked = true;
        } else if (status === 'offline' || status === 'online') {
          updateData.isBlocked = false;
        }
      }

      const updatedUser = await prisma.user.update({
        where: { id: targetId },
        data: updateData,
      });

      return res.json({ success: true, data: updatedUser });
    } catch (error) {
      console.error('Error updating user:', error);
      return res.status(500).json({ error: 'Failed to update user' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await prisma.user.delete({ where: { id: targetId } });
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to delete user' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
});

/**
 * POST/PUT /api/users/profile - Profile update handler alias
 */
router.all('/profile', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (req.method === 'GET') {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    return res.json({ success: true, data: user });
  }
  
  try {
    const {
      display_name, fullName, bio, avatar_url, avatarUrl, banner_url, bannerUrl, department, level, college,
      phone_number, phoneNumber, websiteUrl, website_url, facebookUrl, facebook_url, twitterUrl, twitter_url,
      instagramUrl, instagram_url, linkedinUrl, linkedin_url, tiktokUrl, tiktok_url, youtubeUrl, youtube_url,
      snapchatUrl, snapchat_url, githubUrl, github_url, twitchUrl, twitch_url,
    } = req.body;

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(fullName !== undefined && { fullName }),
        ...(display_name !== undefined && { fullName: display_name }),
        ...(bio !== undefined && { bio }),
        ...(avatarUrl !== undefined && { avatarUrl }),
        ...(avatar_url !== undefined && { avatarUrl: avatar_url }),
        ...(bannerUrl !== undefined && { bannerUrl }),
        ...(banner_url !== undefined && { bannerUrl: banner_url }),
        ...(department !== undefined && { department }),
        ...(level !== undefined && { level }),
        ...(college !== undefined && { college }),
        ...(phoneNumber !== undefined && { phoneNumber }),
        ...(phone_number !== undefined && { phoneNumber: phone_number }),
        ...(websiteUrl !== undefined && { websiteUrl }),
        ...(website_url !== undefined && { websiteUrl: website_url }),
        ...(facebookUrl !== undefined && { facebookUrl }),
        ...(facebook_url !== undefined && { facebookUrl: facebook_url }),
        ...(twitterUrl !== undefined && { twitterUrl }),
        ...(twitter_url !== undefined && { twitterUrl: twitter_url }),
        ...(instagramUrl !== undefined && { instagramUrl }),
        ...(instagram_url !== undefined && { instagramUrl: instagram_url }),
        ...(linkedinUrl !== undefined && { linkedinUrl }),
        ...(linkedin_url !== undefined && { linkedinUrl: linkedin_url }),
        ...(tiktokUrl !== undefined && { tiktokUrl }),
        ...(tiktok_url !== undefined && { tiktokUrl: tiktok_url }),
        ...(youtubeUrl !== undefined && { youtubeUrl }),
        ...(youtube_url !== undefined && { youtubeUrl: youtube_url }),
        ...(snapchatUrl !== undefined && { snapchatUrl }),
        ...(snapchat_url !== undefined && { snapchatUrl: snapchat_url }),
        ...(githubUrl !== undefined && { githubUrl }),
        ...(github_url !== undefined && { githubUrl: github_url }),
        ...(twitchUrl !== undefined && { twitchUrl }),
        ...(twitch_url !== undefined && { twitchUrl: twitch_url }),
      },
    });

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Profile update error:', error);
    return res.status(500).json({ error: 'Failed to update user profile' });
  }
});

const AI_USER_PROFILE = {
  id: 'abuad_ai',
  fullName: 'ABUAD AI Companion',
  username: 'abuad_ai',
  email: 'ai@abuad.edu.ng',
  bio: 'Official ABUAD AI Assistant powered by Llama 3.1. Ask me anything about campus, courses, or events!',
  avatarUrl: 'https://pub-0014553a7b194df8b2d31efb7c6f4921.r2.dev/abuad_ai_avatar.png',
  bannerUrl: null,
  department: 'AI & Data Science',
  college: 'Sciences & Computing',
  phoneNumber: null,
  role: 'ADMIN',
  isVerified: true,
  verificationType: 'GOLD',
  followersCount: 1500,
  followingCount: 1,
  status: 'online',
  streakCount: 99,
  createdAt: new Date().toISOString(),
};

/**
 * GET /api/users/profile/:id - Profile by ID alias
 */
router.get('/profile/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    if (id === 'abuad_ai' || id.toLowerCase() === 'ai' || id === 'ai_bot') {
      return res.json({ success: true, data: AI_USER_PROFILE });
    }

    let user = await prisma.user.findUnique({
      where: { id },
    });
    if (!user) {
      user = await prisma.user.findUnique({
        where: { username: id },
      });
    }
    if (!user) {
      if (id.toLowerCase() === 'abuad_ai' || id.toLowerCase() === 'ai') {
        return res.json({ success: true, data: AI_USER_PROFILE });
      }
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ success: true, data: user });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default router;

