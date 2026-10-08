"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserInterestProfile = getUserInterestProfile;
exports.scorePost = scorePost;
exports.encodeCursor = encodeCursor;
exports.decodeCursor = decodeCursor;
const db_1 = require("../config/db");
/**
 * Build a user interest profile by analyzing recent behavioral signals
 */
async function getUserInterestProfile(userId) {
    const profile = {
        interactedAuthors: {},
        preferredTags: {},
        preferredChannels: {},
        prefersVideo: 0.5,
        seenPostIds: new Set(),
    };
    if (!userId) {
        return profile;
    }
    try {
        // 1. Followed Creators (High affinity)
        const following = await db_1.prisma.follower.findMany({
            where: { followerId: userId },
            select: { followedId: true },
            take: 200,
        });
        for (const f of following) {
            profile.interactedAuthors[f.followedId] = (profile.interactedAuthors[f.followedId] || 0) + 10;
        }
        // 2. Liked Posts (Signals interest in authors, hashtags, channels)
        const recentLikes = await db_1.prisma.postLike.findMany({
            where: { userId },
            take: 50,
            orderBy: { createdAt: 'desc' },
            include: {
                post: {
                    select: { id: true, authorId: true, hashtags: true, channelId: true, mediaType: true },
                },
            },
        });
        let videoCount = 0;
        let totalMedia = 0;
        for (const l of recentLikes) {
            profile.seenPostIds.add(l.post.id);
            profile.interactedAuthors[l.post.authorId] = (profile.interactedAuthors[l.post.authorId] || 0) + 5;
            if (l.post.channelId) {
                profile.preferredChannels[l.post.channelId] = (profile.preferredChannels[l.post.channelId] || 0) + 3;
            }
            if (l.post.mediaType === 'video')
                videoCount++;
            if (l.post.mediaType && l.post.mediaType !== 'none')
                totalMedia++;
            try {
                const tags = JSON.parse(l.post.hashtags || '[]');
                for (const tag of tags) {
                    const cleanTag = tag.toLowerCase().replace('#', '');
                    profile.preferredTags[cleanTag] = (profile.preferredTags[cleanTag] || 0) + 4;
                }
            }
            catch { }
        }
        // 3. Saved Posts (Strongest deliberate signal)
        const recentSaves = await db_1.prisma.savedPost.findMany({
            where: { userId },
            take: 30,
            orderBy: { createdAt: 'desc' },
            include: {
                post: {
                    select: { id: true, authorId: true, hashtags: true, channelId: true },
                },
            },
        });
        for (const s of recentSaves) {
            profile.seenPostIds.add(s.post.id);
            profile.interactedAuthors[s.post.authorId] = (profile.interactedAuthors[s.post.authorId] || 0) + 8;
            try {
                const tags = JSON.parse(s.post.hashtags || '[]');
                for (const tag of tags) {
                    const cleanTag = tag.toLowerCase().replace('#', '');
                    profile.preferredTags[cleanTag] = (profile.preferredTags[cleanTag] || 0) + 6;
                }
            }
            catch { }
        }
        // 4. Comments Made by User
        const recentComments = await db_1.prisma.postComment.findMany({
            where: { authorId: userId },
            take: 30,
            select: { postId: true },
        });
        for (const c of recentComments) {
            profile.seenPostIds.add(c.postId);
        }
        if (totalMedia > 0) {
            profile.prefersVideo = videoCount / totalMedia;
        }
    }
    catch (err) {
        console.error('Error computing user interest profile:', err);
    }
    return profile;
}
/**
 * Score a single candidate post for a user
 */
function scorePost(post, userProfile) {
    const now = Date.now();
    const postTime = new Date(post.createdAt).getTime();
    const hoursOld = Math.max(0.1, (now - postTime) / (1000 * 60 * 60));
    // 1. Freshness Score: Exponential decay with 36-hour half-life
    const freshnessScore = Math.exp(-hoursOld / 36) * 100;
    // 2. Creator Affinity
    const authorAffinity = userProfile.interactedAuthors[post.authorId] || 0;
    const creatorScore = Math.min(100, authorAffinity * 8);
    // 3. Topic & Tag Matching Score
    let topicScore = 0;
    try {
        const tags = JSON.parse(post.hashtags || '[]');
        for (const tag of tags) {
            const cleanTag = tag.toLowerCase().replace('#', '');
            if (userProfile.preferredTags[cleanTag]) {
                topicScore += userProfile.preferredTags[cleanTag] * 12;
            }
        }
    }
    catch { }
    topicScore = Math.min(100, topicScore);
    // 4. Channel Affinity
    const channelScore = post.channelId && userProfile.preferredChannels[post.channelId]
        ? Math.min(60, userProfile.preferredChannels[post.channelId] * 10)
        : 0;
    // 5. Global Engagement Rate
    const likesCount = post._count?.likes ?? post.likesCount ?? 0;
    const commentsCount = post._count?.comments ?? post.commentsCount ?? 0;
    const sharesCount = post.sharesCount ?? 0;
    const savesCount = post.savesCount ?? 0;
    const viewsCount = Math.max(1, post.viewsCount ?? 0);
    // Engagement per view or raw engagement points
    const rawEngagement = (likesCount * 3) + (commentsCount * 5) + (sharesCount * 8) + (savesCount * 6);
    const engagementScore = Math.min(100, (rawEngagement / Math.log10(viewsCount + 10)) * 5);
    // 6. Media Format Preference
    let mediaBonus = 0;
    if (post.mediaType === 'video' && userProfile.prefersVideo > 0.6) {
        mediaBonus = 20;
    }
    else if (post.mediaType === 'image') {
        mediaBonus = 10;
    }
    // 7. Verified & Institutional Boost (Official Campus announcements / Gold badge)
    let verifiedBonus = 0;
    if (post.author?.verificationType === 'GOLD')
        verifiedBonus = 25;
    else if (post.author?.isVerified)
        verifiedBonus = 15;
    // 8. Exploration / Serendipity Random Jitter (+- 10 points for discovery)
    const explorationJitter = (Math.random() * 20) - 10;
    // 9. Seen Penalty
    const seenPenalty = userProfile.seenPostIds.has(post.id) ? 80 : 0;
    // Combined Multi-Factor Formula
    const finalScore = (0.25 * freshnessScore) +
        (0.25 * topicScore) +
        (0.20 * creatorScore) +
        (0.15 * engagementScore) +
        (0.05 * channelScore) +
        mediaBonus +
        verifiedBonus +
        explorationJitter -
        seenPenalty;
    return Math.round(finalScore * 100) / 100;
}
/**
 * Encode cursor for opaque pagination
 */
function encodeCursor(cursorData) {
    return Buffer.from(JSON.stringify(cursorData)).toString('base64url');
}
/**
 * Decode cursor
 */
function decodeCursor(cursorString) {
    if (!cursorString)
        return null;
    try {
        const json = Buffer.from(cursorString, 'base64url').toString('utf8');
        return JSON.parse(json);
    }
    catch {
        return null;
    }
}
