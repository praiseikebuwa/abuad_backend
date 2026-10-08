"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateToken = authenticateToken;
exports.optionalAuth = optionalAuth;
exports.requireRole = requireRole;
const jwt_1 = require("../utils/jwt");
const db_1 = require("../config/db");
/**
 * Middleware to authenticate requests using custom JWT Access Token
 */
async function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header' });
    }
    const token = authHeader.split('Bearer ')[1];
    try {
        const payload = (0, jwt_1.verifyAccessToken)(token);
        // Verify user exists and is not blocked
        const dbUser = await db_1.prisma.user.findUnique({
            where: { id: payload.userId },
            select: { id: true, email: true, role: true, isVerified: true, verificationType: true, isBlocked: true },
        });
        if (!dbUser) {
            return res.status(404).json({ error: 'User account not found' });
        }
        if (dbUser.isBlocked) {
            return res.status(403).json({ error: 'User account has been suspended' });
        }
        req.user = {
            id: dbUser.id,
            email: dbUser.email,
            role: dbUser.role,
            isVerified: dbUser.isVerified,
            verificationType: dbUser.verificationType,
        };
        next();
    }
    catch (error) {
        return res.status(401).json({ error: 'Unauthorized: Access token expired or invalid' });
    }
}
/**
 * Middleware to optionally authenticate requests (populates req.user if valid token present, doesn't block if absent)
 */
async function optionalAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next();
    }
    const token = authHeader.split('Bearer ')[1];
    try {
        const payload = (0, jwt_1.verifyAccessToken)(token);
        const dbUser = await db_1.prisma.user.findUnique({
            where: { id: payload.userId },
            select: { id: true, email: true, role: true, isVerified: true, verificationType: true, isBlocked: true },
        });
        if (dbUser && !dbUser.isBlocked) {
            req.user = {
                id: dbUser.id,
                email: dbUser.email,
                role: dbUser.role,
                isVerified: dbUser.isVerified,
                verificationType: dbUser.verificationType,
            };
        }
    }
    catch (_) {
        // Ignore invalid token in optional auth
    }
    next();
}
/**
 * Middleware to restrict route access by User Role (e.g., ADMIN, STAFF, STUDENT)
 */
function requireRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
        }
        next();
    };
}
