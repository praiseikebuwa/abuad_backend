import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { prisma } from '../config/db';
import { getOrCreateAiUser, triggerAiDirectChatReply } from '../services/aiBotService';

const router = Router();

async function formatChannel(ch: any, currentUserId: string) {
  let memberIds: string[] = [];
  try {
    memberIds = typeof ch.memberIds === 'string' ? JSON.parse(ch.memberIds || '[]') : (ch.memberIds || []);
  } catch {}

  // Fetch all members from User table
  const members = await prisma.user.findMany({
    where: { id: { in: memberIds } },
    select: { id: true, username: true, fullName: true, avatarUrl: true, verificationType: true },
  });

  const memberNames: Record<string, string> = {};
  const memberAvatars: Record<string, string | null> = {};
  const verificationTypes: Record<string, string> = {};

  for (const m of members) {
    memberNames[m.id] = m.fullName || m.username || 'Student';
    memberAvatars[m.id] = m.avatarUrl || null;
    verificationTypes[m.id] = m.verificationType || 'none';
  }

  const isGroup = ch.type === 'group' || ch.isGroup || memberIds.length > 2;
  const otherMemberId = memberIds.find((id) => id !== currentUserId) || memberIds[0] || '';
  const otherUser = members.find((m) => m.id === otherMemberId);

  const displayName = isGroup
    ? (ch.name || 'Group Chat')
    : (otherUser ? (otherUser.fullName || otherUser.username) : (ch.name || 'Direct Message'));

  const displayAvatarUrl = isGroup
    ? null
    : (otherUser?.avatarUrl || null);

  let pinnedBy: string[] = [];
  let archivedBy: string[] = [];
  let typingUsers: Record<string, boolean> = {};

  try { pinnedBy = typeof ch.pinnedBy === 'string' ? JSON.parse(ch.pinnedBy || '[]') : (ch.pinnedBy || []); } catch {}
  try { archivedBy = typeof ch.archivedBy === 'string' ? JSON.parse(ch.archivedBy || '[]') : (ch.archivedBy || []); } catch {}
  try { typingUsers = typeof ch.typingUsers === 'string' ? JSON.parse(ch.typingUsers || '{}') : (ch.typingUsers || {}); } catch {}

  return {
    id: ch.id,
    type: isGroup ? 'group' : 'direct',
    isGroup,
    name: displayName,
    displayName,
    display_name: displayName,
    displayAvatarUrl,
    display_avatar_url: displayAvatarUrl,
    memberIds,
    member_ids: memberIds,
    memberNames,
    member_names: memberNames,
    memberAvatars,
    member_avatars: memberAvatars,
    verificationTypes,
    verification_types: verificationTypes,
    adminIds: typeof ch.adminIds === 'string' ? JSON.parse(ch.adminIds || '[]') : (ch.adminIds || []),
    admin_ids: typeof ch.adminIds === 'string' ? JSON.parse(ch.adminIds || '[]') : (ch.adminIds || []),
    lastMessage: ch.lastMessage ? { content: ch.lastMessage, text: ch.lastMessage } : {},
    last_message: ch.lastMessage ? { content: ch.lastMessage, text: ch.lastMessage } : {},
    lastMessageTime: ch.lastMessageTime || ch.createdAt,
    last_message_time: ch.lastMessageTime || ch.createdAt,
    streakCount: ch.streakCount || 0,
    streak_count: ch.streakCount || 0,
    pinnedBy,
    pinned_by: pinnedBy,
    archivedBy,
    archived_by: archivedBy,
    typingUsers,
    typing_users: typingUsers,
    unreadCounts: {},
    unread_counts: {},
  };
}

function formatMessage(msg: any) {
  let reactions: Record<string, string> = {};
  let savedBy: string[] = [];
  let readBy: string[] = [];
  try { reactions = typeof msg.reactions === 'string' ? JSON.parse(msg.reactions || '{}') : (msg.reactions || {}); } catch {}
  try { savedBy = typeof msg.savedBy === 'string' ? JSON.parse(msg.savedBy || '[]') : (msg.savedBy || []); } catch {}
  try { readBy = typeof msg.readBy === 'string' ? JSON.parse(msg.readBy || '[]') : (msg.readBy || []); } catch {}

  const isRead = readBy.length > 1;

  return {
    ...msg,
    senderId: msg.senderId,
    sender_id: msg.senderId,
    content: msg.text || msg.content || '',
    text: msg.text || msg.content || '',
    type: msg.type || 'text',
    mediaUrl: msg.mediaUrl || null,
    imageUrl: msg.mediaUrl || null,
    image_url: msg.mediaUrl || null,
    reactions,
    savedBy,
    saved_by: savedBy,
    readBy,
    read_by: readBy,
    isRead,
    is_read: isRead,
    timestamp: msg.createdAt,
    created_at: msg.createdAt,
  };
}

/**
 * GET /api/chat/channels - List all channels/DMs the user is part of
 */
router.get(['/', '/channels'], authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    // Get channels where user is a member
    const allChannels = await prisma.chatChannel.findMany({
      orderBy: { lastMessageTime: 'desc' },
      take: 100,
    });

    const userChannels = allChannels.filter(ch => {
      try {
        const members: string[] = JSON.parse(ch.memberIds);
        return members.includes(userId);
      } catch {
        return false;
      }
    });

    const formattedChannels = await Promise.all(
      userChannels.map(ch => formatChannel(ch, userId))
    );

    return res.json({ success: true, data: formattedChannels });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch chat channels' });
  }
});

/**
 * POST /api/chat/direct - Find or create direct DM channel with another user or AI
 */
router.post('/direct', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    let { targetUserId, otherUserName, otherUserAvatar } = req.body;

    if (!targetUserId) {
      return res.status(400).json({ error: 'Target user ID is required' });
    }

    // Handle AI bot alias or username lookup
    if (targetUserId === 'abuad_ai' || targetUserId === 'ai') {
      const aiUser = await getOrCreateAiUser();
      targetUserId = aiUser.id;
      otherUserName = aiUser.fullName;
      otherUserAvatar = aiUser.avatarUrl;
    }

    // Check if direct channel already exists
    const allChannels = await prisma.chatChannel.findMany({
      where: {
        type: 'direct',
      },
    });

    const existing = allChannels.find(ch => {
      try {
        const members: string[] = JSON.parse(ch.memberIds);
        return members.includes(userId) && members.includes(targetUserId) && members.length === 2;
      } catch {
        return false;
      }
    });

    if (existing) {
      const formatted = await formatChannel(existing, userId);
      return res.json({ success: true, data: formatted });
    }

    // Fetch other user if name/avatar not provided
    if (!otherUserName) {
      const otherUser = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { fullName: true, username: true, avatarUrl: true },
      });
      if (otherUser) {
        otherUserName = otherUser.fullName || otherUser.username;
        otherUserAvatar = otherUser.avatarUrl;
      }
    }

    // Create new direct channel
    const newChannel = await prisma.chatChannel.create({
      data: {
        name: otherUserName || 'Direct Message',
        type: 'direct',
        isGroup: false,
        memberIds: JSON.stringify([userId, targetUserId]),
      },
    });

    const formatted = await formatChannel(newChannel, userId);
    return res.status(201).json({ success: true, data: formatted });
  } catch (error) {
    console.error('Error creating direct chat channel:', error);
    return res.status(500).json({ error: 'Failed to create direct channel' });
  }
});

/**
 * POST /api/chat/channels - Create a new channel or DM
 */
router.post('/channels', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, type, memberIds, isGroup } = req.body;
    const allMemberIds: string[] = [...new Set([req.user!.id, ...(memberIds || [])])];

    const channel = await prisma.chatChannel.create({
      data: {
        name: name || null,
        type: type || (allMemberIds.length > 2 ? 'group' : 'direct'),
        isGroup: isGroup || allMemberIds.length > 2,
        memberIds: JSON.stringify(allMemberIds),
      },
    });

    const formatted = await formatChannel(channel, req.user!.id);
    return res.status(201).json({ success: true, data: formatted });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create channel' });
  }
});

/**
 * GET /api/chat/channels/:id - Get single channel info
 */
router.get('/channels/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const channel = await prisma.chatChannel.findUnique({ where: { id: String(req.params.id) } });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    const formatted = await formatChannel(channel, req.user!.id);
    return res.json({ success: true, data: formatted });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch channel' });
  }
});

/**
 * PATCH /api/chat/channels/:id - Update channel settings
 */
router.patch('/channels/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, restrictMessaging, restrictInfoUpdates } = req.body;
    const channel = await prisma.chatChannel.update({
      where: { id: String(req.params.id) },
      data: {
        ...(name !== undefined && { name }),
        ...(restrictMessaging !== undefined && { restrictMessaging }),
        ...(restrictInfoUpdates !== undefined && { restrictInfoUpdates }),
      },
    });
    const formatted = await formatChannel(channel, req.user!.id);
    return res.json({ success: true, data: formatted });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update channel' });
  }
});

/**
 * POST /api/chat/channels/:id/pin - Pin/unpin a channel
 */
router.post('/channels/:id/pin', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const channel = await prisma.chatChannel.findUnique({ where: { id: String(req.params.id) } });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    let pinnedBy: string[] = [];
    try { pinnedBy = JSON.parse(channel.pinnedBy); } catch {}

    const isPinned = pinnedBy.includes(userId);
    const updatedPinnedBy = isPinned ? pinnedBy.filter(id => id !== userId) : [...pinnedBy, userId];

    await prisma.chatChannel.update({
      where: { id: String(req.params.id) },
      data: { pinnedBy: JSON.stringify(updatedPinnedBy) },
    });

    return res.json({ success: true, isPinned: !isPinned });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to pin/unpin channel' });
  }
});

/**
 * POST /api/chat/channels/:id/archive - Archive/unarchive a channel
 */
router.post('/channels/:id/archive', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const channel = await prisma.chatChannel.findUnique({ where: { id: String(req.params.id) } });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    let archivedBy: string[] = [];
    try { archivedBy = JSON.parse(channel.archivedBy); } catch {}

    const isArchived = archivedBy.includes(userId);
    const updatedArchivedBy = isArchived ? archivedBy.filter(id => id !== userId) : [...archivedBy, userId];

    await prisma.chatChannel.update({
      where: { id: String(req.params.id) },
      data: { archivedBy: JSON.stringify(updatedArchivedBy) },
    });

    return res.json({ success: true, isArchived: !isArchived });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to archive/unarchive channel' });
  }
});

/**
 * POST /api/chat/channels/:id/read - Mark messages as read by current user
 */
router.post('/channels/:id/read', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const channelId = String(req.params.id);
    const messages = await prisma.chatMessage.findMany({
      where: { channelId },
    });
    for (const msg of messages) {
      let readBy: string[] = [];
      try { readBy = JSON.parse(msg.readBy); } catch {}
      if (!readBy.includes(userId)) {
        readBy.push(userId);
        await prisma.chatMessage.update({
          where: { id: msg.id },
          data: { readBy: JSON.stringify(readBy) },
        });
      }
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to mark channel as read' });
  }
});

/**
 * DELETE /api/chat/channels/:id - Delete/clear conversation
 */
router.delete('/channels/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const channelId = String(req.params.id);
    const channel = await prisma.chatChannel.findUnique({ where: { id: channelId } });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    // Delete associated messages
    await prisma.chatMessage.deleteMany({
      where: { channelId },
    });

    // Delete channel
    await prisma.chatChannel.delete({
      where: { id: channelId },
    });

    return res.json({ success: true, message: 'Channel deleted successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete channel' });
  }
});

/**
 * DELETE /api/chat/channels/:id/messages - Clear all messages in channel
 */
router.delete('/channels/:id/messages', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const channelId = String(req.params.id);
    await prisma.chatMessage.deleteMany({
      where: { channelId },
    });
    await prisma.chatChannel.update({
      where: { id: channelId },
      data: { lastMessage: null, lastMessageTime: null },
    });
    return res.json({ success: true, message: 'Messages cleared successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to clear messages' });
  }
});

/**
 * GET /api/chat/messages - Get messages for a channel or DM
 */
router.get('/messages', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const channelId = req.query.channelId ? String(req.query.channelId) : undefined;
    const receiverId = req.query.receiverId ? String(req.query.receiverId) : undefined;
    const limit = req.query.limit ? String(req.query.limit) : undefined;
    const userId = req.user!.id;
    const msgLimit = Number(limit) || 150;

    let targetChannelId = channelId;

    if (receiverId) {
      // Find or create a direct channel between the two users
      const allChannels = await prisma.chatChannel.findMany({
        where: { type: 'direct' },
      });
      const dmChannel = allChannels.find(ch => {
        try {
          const members: string[] = JSON.parse(ch.memberIds);
          return members.includes(userId) && members.includes(String(receiverId)) && members.length === 2;
        } catch { return false; }
      });

      if (dmChannel) {
        targetChannelId = dmChannel.id;
      }
    }

    if (targetChannelId) {
      const messages = await prisma.chatMessage.findMany({
        where: { channelId: String(targetChannelId), isDeleted: false },
        orderBy: { createdAt: 'asc' },
        take: msgLimit,
        include: {
          sender: { select: { id: true, username: true, fullName: true, avatarUrl: true } },
        },
      });

      const formatted = messages.map(formatMessage);
      return res.json({ success: true, data: formatted });
    }

    return res.json({ success: true, data: [] });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

/**
 * POST /api/chat/send - Send a message
 */
router.post('/send', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { receiverId, channelId, text, mediaUrl, type } = req.body;
    if (!text && !mediaUrl) {
      return res.status(400).json({ error: 'Message content or media required' });
    }

    let targetChannelId = channelId;
    let inferredReceiverId = receiverId;

    if (!inferredReceiverId && channelId && channelId.startsWith('channel_')) {
      inferredReceiverId = channelId.replace('channel_', '');
    }

    const userId = req.user!.id;
    if (inferredReceiverId && inferredReceiverId !== userId) {
      const allChannels = await prisma.chatChannel.findMany({ where: { type: 'direct' } });
      const existing = allChannels.find(ch => {
        try {
          const members: string[] = JSON.parse(ch.memberIds);
          return members.includes(userId) && members.includes(inferredReceiverId) && members.length === 2;
        } catch { return false; }
      });

      if (existing) {
        targetChannelId = existing.id;
      } else {
        const otherUser = await prisma.user.findUnique({
          where: { id: inferredReceiverId },
          select: { fullName: true, username: true, avatarUrl: true },
        });

        const newChannel = await prisma.chatChannel.create({
          data: {
            id: channelId && !channelId.startsWith('channel_') ? channelId : undefined,
            name: otherUser ? (otherUser.fullName || otherUser.username) : 'Direct Message',
            type: 'direct',
            isGroup: false,
            memberIds: JSON.stringify([userId, inferredReceiverId]),
            lastMessage: text || '📎 Media',
            lastMessageTime: new Date(),
          },
        });
        targetChannelId = newChannel.id;
      }
    } else if (targetChannelId) {
      const existingChannel = await prisma.chatChannel.findUnique({ where: { id: targetChannelId } });
      if (!existingChannel) {
        await prisma.chatChannel.create({
          data: {
            id: targetChannelId,
            type: 'direct',
            isGroup: false,
            memberIds: JSON.stringify([userId]),
            lastMessage: text || 'Media',
            lastMessageTime: new Date(),
          },
        });
      }
    }

    if (!targetChannelId) {
      return res.status(400).json({ error: 'Channel or receiver required' });
    }

    const message = await prisma.chatMessage.create({
      data: {
        senderId: req.user!.id,
        channelId: targetChannelId,
        text: text || '',
        mediaUrl: mediaUrl || null,
        type: type || 'text',
      },
      include: {
        sender: { select: { id: true, username: true, fullName: true, avatarUrl: true } },
      },
    });

    try {
      await prisma.chatChannel.update({
        where: { id: targetChannelId },
        data: { lastMessage: text || '📎 Media', lastMessageTime: new Date() },
      });
    } catch (_) {}

    // Asynchronously check and trigger AI response if chatting with ABUAD AI
    try {
      const aiUser = await getOrCreateAiUser();
      let isAiChannel = false;

      if (inferredReceiverId === aiUser.id || inferredReceiverId === 'abuad_ai') {
        isAiChannel = true;
      } else if (targetChannelId) {
        const ch = await prisma.chatChannel.findUnique({ where: { id: targetChannelId } });
        if (ch) {
          try {
            const members: string[] = JSON.parse(ch.memberIds);
            if (members.includes(aiUser.id) || members.includes('abuad_ai')) {
              isAiChannel = true;
            }
          } catch {}
        }
      }

      if (isAiChannel && req.user!.id !== aiUser.id) {
        // Trigger conversational reply after 400ms
        setTimeout(() => {
          triggerAiDirectChatReply(
            targetChannelId,
            text || 'Shared media',
            mediaUrl,
            (req.user as any)?.fullName || (req.user as any)?.username || 'User'
          ).catch(e => console.error('AI direct chat reply error:', e));
        }, 400);
      }
    } catch (e) {
      console.error('Error checking AI channel:', e);
    }

    const formatted = formatMessage(message);
    return res.status(201).json({ success: true, data: formatted });
  } catch (error) {
    console.error('Error sending chat message:', error);
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

/**
 * PATCH /api/chat/messages/:id - Edit a message
 */
router.patch('/messages/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { text } = req.body;
    const msg = await prisma.chatMessage.findUnique({ where: { id: String(req.params.id) } });
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.senderId !== req.user!.id) return res.status(403).json({ error: 'Not authorized' });
    const updated = await prisma.chatMessage.update({ where: { id: String(req.params.id) }, data: { text, isEdited: true } });
    return res.json({ success: true, data: formatMessage(updated) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to edit message' });
  }
});

/**
 * DELETE /api/chat/messages/:id - Delete a message
 */
router.delete('/messages/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const msg = await prisma.chatMessage.findUnique({ where: { id: String(req.params.id) } });
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.senderId !== req.user!.id) return res.status(403).json({ error: 'Not authorized' });
    await prisma.chatMessage.update({ where: { id: String(req.params.id) }, data: { isDeleted: true, text: 'This message was deleted' } });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete message' });
  }
});

/**
 * POST /api/chat/messages/:id/reaction - React to a message
 */
router.post('/messages/:id/reaction', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { emoji } = req.body;
    const userId = req.user!.id;
    const msg = await prisma.chatMessage.findUnique({ where: { id: String(req.params.id) } });
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    let reactions: Record<string, string> = {};
    try { reactions = JSON.parse(msg.reactions); } catch {}

    if (reactions[userId] === emoji) {
      delete reactions[userId]; // toggle off
    } else {
      reactions[userId] = emoji;
    }

    const updated = await prisma.chatMessage.update({
      where: { id: String(req.params.id) },
      data: { reactions: JSON.stringify(reactions) },
    });
    return res.json({ success: true, data: formatMessage(updated) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to react to message' });
  }
});

export default router;

