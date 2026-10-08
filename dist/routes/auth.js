"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../config/db");
const auth_1 = require("../middleware/auth");
const rateLimiter_1 = require("../middleware/rateLimiter");
const jwt_1 = require("../utils/jwt");
const router = (0, express_1.Router)();
// Helper to set HTTP-only refresh token cookie
function setRefreshTokenCookie(res, refreshToken) {
    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 Days
    });
}
/**
 * POST /api/auth/register
 */
router.post('/register', rateLimiter_1.registerLimiter, async (req, res) => {
    try {
        const { email, password, fullName, username, department, level, phoneNumber } = req.body;
        if (!email || !password || !fullName || !username) {
            return res.status(400).json({ error: 'Email, password, fullName, and username are required' });
        }
        const existingUser = await db_1.prisma.user.findFirst({
            where: {
                OR: [{ email }, { username }],
            },
        });
        if (existingUser) {
            return res.status(400).json({ error: 'Email or Username is already registered' });
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 12);
        const emailVerificationToken = crypto_1.default.randomBytes(32).toString('hex');
        const user = await db_1.prisma.user.create({
            data: {
                email,
                passwordHash,
                fullName,
                username,
                department,
                level,
                phoneNumber,
                emailVerificationToken,
            },
        });
        const payload = { userId: user.id, email: user.email, role: user.role };
        const accessToken = (0, jwt_1.generateAccessToken)(payload);
        const refreshToken = (0, jwt_1.generateRefreshToken)(payload);
        const refreshTokenHash = await (0, jwt_1.hashToken)(refreshToken);
        await db_1.prisma.user.update({
            where: { id: user.id },
            data: { refreshTokenHash },
        });
        setRefreshTokenCookie(res, refreshToken);
        return res.status(201).json({
            success: true,
            data: {
                accessToken,
                refreshToken,
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.fullName,
                    username: user.username,
                    role: user.role,
                },
            },
        });
    }
    catch (error) {
        console.error('Registration error:', error);
        return res.status(500).json({ error: 'Failed to register user' });
    }
});
/**
 * POST /api/auth/login
 */
router.post('/login', rateLimiter_1.loginLimiter, async (req, res) => {
    try {
        const { emailOrUsername, password } = req.body;
        if (!emailOrUsername || !password) {
            return res.status(400).json({ error: 'Email/Username and password are required' });
        }
        const user = await db_1.prisma.user.findFirst({
            where: {
                OR: [{ email: emailOrUsername }, { username: emailOrUsername }],
            },
        });
        if (!user) {
            return res.status(401).json({ error: 'Invalid email/username or password' });
        }
        const isValidPassword = await bcryptjs_1.default.compare(password, user.passwordHash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid email/username or password' });
        }
        if (user.isBlocked) {
            return res.status(403).json({ error: 'Account has been suspended' });
        }
        const payload = { userId: user.id, email: user.email, role: user.role };
        const accessToken = (0, jwt_1.generateAccessToken)(payload);
        const refreshToken = (0, jwt_1.generateRefreshToken)(payload);
        const refreshTokenHash = await (0, jwt_1.hashToken)(refreshToken);
        await db_1.prisma.user.update({
            where: { id: user.id },
            data: { refreshTokenHash },
        });
        setRefreshTokenCookie(res, refreshToken);
        return res.json({
            success: true,
            data: {
                accessToken,
                refreshToken, // Returned for mobile client storage if cookies are not used
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.fullName,
                    username: user.username,
                    role: user.role,
                    avatarUrl: user.avatarUrl,
                    college: user.college,
                    department: user.department,
                    phoneNumber: user.phoneNumber,
                    bio: user.bio,
                },
            },
        });
    }
    catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ error: 'Failed to authenticate user' });
    }
});
/**
 * POST /api/auth/refresh (Rotating Refresh Token)
 */
router.post('/refresh', async (req, res) => {
    try {
        const rawRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
        if (!rawRefreshToken) {
            return res.status(401).json({ error: 'Refresh token required' });
        }
        const payload = (0, jwt_1.verifyRefreshToken)(rawRefreshToken);
        const user = await db_1.prisma.user.findUnique({
            where: { id: payload.userId },
        });
        if (!user || !user.refreshTokenHash) {
            return res.status(401).json({ error: 'Invalid refresh token session' });
        }
        const isValid = await (0, jwt_1.compareToken)(rawRefreshToken, user.refreshTokenHash);
        if (!isValid) {
            // Security alert: Invalidate all refresh tokens if reuse detected
            await db_1.prisma.user.update({
                where: { id: user.id },
                data: { refreshTokenHash: null },
            });
            return res.status(401).json({ error: 'Compromised refresh token session' });
        }
        // Rotate tokens: Issue NEW access token and NEW refresh token
        const newPayload = { userId: user.id, email: user.email, role: user.role };
        const newAccessToken = (0, jwt_1.generateAccessToken)(newPayload);
        const newRefreshToken = (0, jwt_1.generateRefreshToken)(newPayload);
        const newRefreshTokenHash = await (0, jwt_1.hashToken)(newRefreshToken);
        await db_1.prisma.user.update({
            where: { id: user.id },
            data: { refreshTokenHash: newRefreshTokenHash },
        });
        setRefreshTokenCookie(res, newRefreshToken);
        return res.json({
            success: true,
            data: {
                accessToken: newAccessToken,
                refreshToken: newRefreshToken,
            },
        });
    }
    catch (error) {
        return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
});
/**
 * POST /api/auth/logout
 */
router.post('/logout', auth_1.authenticateToken, async (req, res) => {
    try {
        await db_1.prisma.user.update({
            where: { id: req.user.id },
            data: { refreshTokenHash: null },
        });
        res.clearCookie('refreshToken');
        return res.json({ success: true, message: 'Successfully logged out' });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to logout' });
    }
});
/**
 * GET /api/auth/me
 */
router.get('/me', auth_1.authenticateToken, async (req, res) => {
    try {
        const user = await db_1.prisma.user.findUnique({
            where: { id: req.user.id },
            select: {
                id: true,
                email: true,
                fullName: true,
                username: true,
                bio: true,
                avatarUrl: true,
                bannerUrl: true,
                department: true,
                college: true,
                level: true,
                phoneNumber: true,
                role: true,
                isVerified: true,
                isEmailVerified: true,
                followersCount: true,
                followingCount: true,
                createdAt: true,
            },
        });
        return res.json({ success: true, data: user });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch user profile' });
    }
});
/**
 * POST /api/auth/forgot-password
 */
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email)
            return res.status(400).json({ error: 'Email is required' });
        const user = await db_1.prisma.user.findUnique({ where: { email } });
        if (!user) {
            // Do not reveal email existence for security
            return res.json({ success: true, message: 'Password reset link sent if account exists' });
        }
        const passwordResetToken = crypto_1.default.randomBytes(32).toString('hex');
        const passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await db_1.prisma.user.update({
            where: { id: user.id },
            data: {
                passwordResetToken,
                passwordResetExpires,
            },
        });
        return res.json({
            success: true,
            message: 'Password reset token generated',
            resetToken: passwordResetToken, // In production, send this via email link
        });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to initiate password reset' });
    }
});
/**
 * POST /api/auth/reset-password
 */
router.post('/reset-password', async (req, res) => {
    try {
        const { resetToken, newPassword } = req.body;
        if (!resetToken || !newPassword) {
            return res.status(400).json({ error: 'Reset token and new password are required' });
        }
        const user = await db_1.prisma.user.findFirst({
            where: {
                passwordResetToken: resetToken,
                passwordResetExpires: { gt: new Date() },
            },
        });
        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired password reset token' });
        }
        const passwordHash = await bcryptjs_1.default.hash(newPassword, 12);
        await db_1.prisma.user.update({
            where: { id: user.id },
            data: {
                passwordHash,
                passwordResetToken: null,
                passwordResetExpires: null,
                refreshTokenHash: null, // Invalidate existing sessions
            },
        });
        return res.json({ success: true, message: 'Password successfully reset' });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to reset password' });
    }
});
/**
 * POST /api/auth/sync
 * Sync user presence/lifecycle status
 */
router.post('/sync', async (req, res) => {
    return res.json({ success: true });
});
exports.default = router;
