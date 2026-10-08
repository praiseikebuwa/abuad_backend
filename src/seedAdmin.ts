import bcrypt from 'bcryptjs';
import { prisma } from './config/db';

async function seedAdmin() {
  const email = 'admin@abuad.edu.ng';
  const password = 'pasword123';
  const username = 'admin';
  const fullName = 'System Administrator';

  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
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

  await prisma.$disconnect();
}

seedAdmin().catch(err => {
  console.error('❌ Error seeding admin:', err);
  process.exit(1);
});
