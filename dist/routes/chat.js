"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const db_1 = require("../config/db");
const router = (0, express_1.Router)();
/**
 * GET /api/chat/channels - List all channels/DMs the user is part of
 */
router.get(['/', '/channels'], auth_1.authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        // Get channels where user is a member (their ID appears in memberIds JSON)
        const allChannels = await db_1.prisma.chatChannel.findMany({
            orderBy: { lastMessageTime: 'desc' },
            take: 100,
        });
        // Filter to channels where user is a member
        const userChannels = allChannels.filter(ch => {
            try {
                const members = JSON.parse(ch.memberIds);
                return members.includes(userId);
            }
            catch {
                return false;
            }
        });
        return res.json({ success: true, data: userChannels });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch chat channels' });
    }
});
/**
 * POST /api/chat/channels - Create a new channel or DM
 */
router.post('/channels', auth_1.authenticateToken, async (req, res) => {
    try {
        const { name, type, memberIds, isGroup } = req.body;
        const allMemberIds = [...new Set([req.user.id, ...(memberIds || [])])];
        const channel = await db_1.prisma.chatChannel.create({
            data: {
                name: name || null,
                type: type || (allMemberIds.length > 2 ? 'group' : 'direct'),
                isGroup: isGroup || allMemberIds.length > 2,
                memberIds: JSON.stringify(allMemberIds),
            },
        });
        return res.status(201).json({ success: true, data: channel });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to create channel' });
    }
});
/**
 * GET /api/chat/channels/:id - Get single channel info
 */
router.get('/channels/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const channel = await db_1.prisma.chatChannel.findUnique({ where: { id: String(req.params.id) } });
        if (!channel)
            return res.status(404).json({ error: 'Channel not found' });
        return res.json({ success: true, data: channel });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch channel' });
    }
});
/**
 * PATCH /api/chat/channels/:id - Update channel settings
 */
router.patch('/channels/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const { name, restrictMessaging, restrictInfoUpdates } = req.body;
        const channel = await db_1.prisma.chatChannel.update({
            where: { id: String(req.params.id) },
            data: {
                ...(name !== undefined && { name }),
                ...(restrictMessaging !== undefined && { restrictMessaging }),
                ...(restrictInfoUpdates !== undefined && { restrictInfoUpdates }),
            },
        });
        return res.json({ success: true, data: channel });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to update channel' });
    }
});
/**
 * POST /api/chat/channels/:id/pin - Pin/unpin a channel
 */
router.post('/channels/:id/pin', auth_1.authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const channel = await db_1.prisma.chatChannel.findUnique({ where: { id: String(req.params.id) } });
        if (!channel)
            return res.status(404).json({ error: 'Channel not found' });
        let pinnedBy = [];
        try {
            pinnedBy = JSON.parse(channel.pinnedBy);
        }
        catch { }
        const isPinned = pinnedBy.includes(userId);
        const updatedPinnedBy = isPinned ? pinnedBy.filter(id => id !== userId) : [...pinnedBy, userId];
        await db_1.prisma.chatChannel.update({
            where: { id: String(req.params.id) },
            data: { pinnedBy: JSON.stringify(updatedPinnedBy) },
        });
        return res.json({ success: true, isPinned: !isPinned });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to pin/unpin channel' });
    }
});
/**
 * GET /api/chat/messages - Get messages for a channel or DM
 */
router.get('/messages', auth_1.authenticateToken, async (req, res) => {
    try {
        const channelId = req.query.channelId ? String(req.query.channelId) : undefined;
        const receiverId = req.query.receiverId ? String(req.query.receiverId) : undefined;
        const limit = req.query.limit ? String(req.query.limit) : undefined;
        const userId = req.user.id;
        const msgLimit = Number(limit) || 100;
        if (channelId) {
            const messages = await db_1.prisma.chatMessage.findMany({
                where: { channelId: String(channelId), isDeleted: false },
                orderBy: { createdAt: 'asc' },
                take: msgLimit,
                include: {
                    sender: { select: { id: true, username: true, fullName: true, avatarUrl: true } },
                },
            });
            return res.json({ success: true, data: messages });
        }
        if (receiverId) {
            // DM — find or create a direct channel between the two users
            const allChannels = await db_1.prisma.chatChannel.findMany({
                where: { type: 'direct' },
            });
            const dmChannel = allChannels.find(ch => {
                try {
                    const members = JSON.parse(ch.memberIds);
                    return members.includes(userId) && members.includes(String(receiverId)) && members.length === 2;
                }
                catch {
                    return false;
                }
            });
            if (!dmChannel)
                return res.json({ success: true, data: [] });
            const messages = await db_1.prisma.chatMessage.findMany({
                where: { channelId: dmChannel.id, isDeleted: false },
                orderBy: { createdAt: 'asc' },
                take: msgLimit,
                include: {
                    sender: { select: { id: true, username: true, fullName: true, avatarUrl: true } },
                },
            });
            return res.json({ success: true, data: messages });
        }
        return res.status(400).json({ error: 'Must provide receiverId or channelId' });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch messages' });
    }
});
/**
 * POST /api/chat/send - Send a message
 */
router.post('/send', auth_1.authenticateToken, async (req, res) => {
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
        const userId = req.user.id;
        if (inferredReceiverId && inferredReceiverId !== userId) {
            const allChannels = await db_1.prisma.chatChannel.findMany({ where: { type: 'direct' } });
            const existing = allChannels.find(ch => {
                try {
                    const members = JSON.parse(ch.memberIds);
                    return members.includes(userId) && members.includes(inferredReceiverId) && members.length === 2;
                }
                catch {
                    return false;
                }
            });
            if (existing) {
                targetChannelId = existing.id;
            }
            else {
                const newChannel = await db_1.prisma.chatChannel.create({
                    data: {
                        id: channelId || undefined,
                        type: 'direct',
                        isGroup: false,
                        memberIds: JSON.stringify([userId, inferredReceiverId]),
                        lastMessage: text || '📎 Media',
                        lastMessageTime: new Date(),
                    },
                });
                targetChannelId = newChannel.id;
            }
        }
        else if (targetChannelId) {
            const existingChannel = await db_1.prisma.chatChannel.findUnique({ where: { id: targetChannelId } });
            if (!existingChannel) {
                await db_1.prisma.chatChannel.create({
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
        const message = await db_1.prisma.chatMessage.create({
            data: {
                senderId: req.user.id,
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
            await db_1.prisma.chatChannel.update({
                where: { id: targetChannelId },
                data: { lastMessage: text || '📎 Media', lastMessageTime: new Date() },
            });
        }
        catch (_) { }
        return res.status(201).json({ success: true, data: message });
    }
    catch (error) {
        console.error('Error sending chat message:', error);
        return res.status(500).json({ error: 'Failed to send message' });
    }
});
/**
 * PATCH /api/chat/messages/:id - Edit a message
 */
router.patch('/messages/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const { text } = req.body;
        const msg = await db_1.prisma.chatMessage.findUnique({ where: { id: String(req.params.id) } });
        if (!msg)
            return res.status(404).json({ error: 'Message not found' });
        if (msg.senderId !== req.user.id)
            return res.status(403).json({ error: 'Not authorized' });
        const updated = await db_1.prisma.chatMessage.update({ where: { id: String(req.params.id) }, data: { text, isEdited: true } });
        return res.json({ success: true, data: updated });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to edit message' });
    }
});
/**
 * DELETE /api/chat/messages/:id - Delete a message
 */
router.delete('/messages/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const msg = await db_1.prisma.chatMessage.findUnique({ where: { id: String(req.params.id) } });
        if (!msg)
            return res.status(404).json({ error: 'Message not found' });
        if (msg.senderId !== req.user.id)
            return res.status(403).json({ error: 'Not authorized' });
        await db_1.prisma.chatMessage.update({ where: { id: String(req.params.id) }, data: { isDeleted: true, text: 'This message was deleted' } });
        return res.json({ success: true });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to delete message' });
    }
});
/**
 * POST /api/chat/messages/:id/reaction - React to a message
 */
router.post('/messages/:id/reaction', auth_1.authenticateToken, async (req, res) => {
    try {
        const { emoji } = req.body;
        const userId = req.user.id;
        const msg = await db_1.prisma.chatMessage.findUnique({ where: { id: String(req.params.id) } });
        if (!msg)
            return res.status(404).json({ error: 'Message not found' });
        let reactions = {};
        try {
            reactions = JSON.parse(msg.reactions);
        }
        catch { }
        if (reactions[userId] === emoji) {
            delete reactions[userId]; // toggle off
        }
        else {
            reactions[userId] = emoji;
        }
        const updated = await db_1.prisma.chatMessage.update({
            where: { id: String(req.params.id) },
            data: { reactions: JSON.stringify(reactions) },
        });
        return res.json({ success: true, data: updated });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to react to message' });
    }
});
exports.default = router;
