"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerLimiter = exports.loginLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
/**
 * Strict Rate Limiter for Login and Sensitive Auth Endpoints
 */
exports.loginLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes window
    max: 5, // Limit each IP to 5 failed login attempts per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many authentication attempts from this IP, please try again after 15 minutes.',
    },
});
/**
 * Rate Limiter for Registration
 */
exports.registerLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000, // 1 hour window
    max: 10, // Limit each IP to 10 user registrations per hour
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many accounts created from this IP, please try again later.',
    },
});
