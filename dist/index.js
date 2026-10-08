"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const dotenv_1 = __importDefault(require("dotenv"));
const auth_1 = __importDefault(require("./routes/auth"));
const users_1 = __importDefault(require("./routes/users"));
const posts_1 = __importDefault(require("./routes/posts"));
const chat_1 = __importDefault(require("./routes/chat"));
const marketplace_1 = __importDefault(require("./routes/marketplace"));
const events_1 = __importDefault(require("./routes/events"));
const stories_1 = __importDefault(require("./routes/stories"));
const ai_1 = __importDefault(require("./routes/ai"));
const media_1 = __importDefault(require("./routes/media"));
const utilities_1 = __importDefault(require("./routes/utilities"));
const admin_1 = __importDefault(require("./routes/admin"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
// Middlewares
app.use((0, cors_1.default)({
    origin: true,
    credentials: true,
}));
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, cookie_parser_1.default)());
// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'ABUAD API Backend (JWT Native Auth)', timestamp: new Date().toISOString() });
});
// API Routes
app.use('/api/auth', auth_1.default);
app.use('/api/users', users_1.default);
app.use('/api/posts', posts_1.default);
app.use('/api/chat', chat_1.default);
app.use('/api/marketplace', marketplace_1.default);
app.use('/api/events', events_1.default);
app.use('/api/stories', stories_1.default);
app.use('/api/ai', ai_1.default);
app.use('/api/media', media_1.default);
app.use('/api/utilities', utilities_1.default);
app.use('/api/admin', admin_1.default);
// Direct collection alias routes for legacy/admin client calls
app.use('/api/system', admin_1.default);
app.use('/api/system/config', admin_1.default);
app.use('/api/resources', admin_1.default);
app.use('/api/announcements', admin_1.default);
app.use('/api/reports', admin_1.default);
app.use('/api/marketplace_items', marketplace_1.default);
app.use('/api/groups', events_1.default);
app.use('/api/channels', chat_1.default);
app.use('/api/sos_alerts', utilities_1.default);
app.use('/api/notifications', utilities_1.default);
app.use('/api/presence', utilities_1.default);
// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Unhandled Server Error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
});
app.listen(PORT, () => {
    console.log(`🚀 ABUAD Backend Server running on http://localhost:${PORT}`);
});
