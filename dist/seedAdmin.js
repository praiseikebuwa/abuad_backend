"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("./config/db");
async function seedAdmin() {
    const email = 'admin@abuad.edu.ng';
    const password = 'pasword123';
    const username = 'admin';
    const fullName = 'System Administrator';
    const passwordHash = await bcryptjs_1.default.hash(password, 12);
    const admin = await db_1.prisma.user.upsert({
        where: { email },
        update: {
            passwordHash,
            role: 'ADMIN',
            isVerified: true,
            isEmailVerified: true,
        },
        create: {
            email,
            passwordHash,
            username,
            fullName,
            role: 'ADMIN',
            isVerified: true,
            isEmailVerified: true,
            department: 'Administration',
        },
    });
    console.log('✅ Admin user created/updated successfully in database!');
    console.log('   Email:', admin.email);
    console.log('   Username:', admin.username);
    console.log('   Role:', admin.role);
    await db_1.prisma.$disconnect();
}
seedAdmin().catch(err => {
    console.error('❌ Error seeding admin:', err);
    process.exit(1);
});
