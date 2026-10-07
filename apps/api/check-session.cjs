const { PrismaClient } = require('@prisma/client');
(async () => {
  const prisma = new PrismaClient();
  const u = await prisma.user.findFirst({ where: { email: 'persona.tech@c7ntax.local' }, select: { id: true } });
  const rows = await prisma.userSession.findMany({ where: { userId: u.id }, select: { id: true, lastActivityAt: true, invalidatedAt: true, expiresAt: true }, orderBy: { lastActivityAt: 'desc' }, take: 4 });
  console.log(JSON.stringify(rows, null, 1));
  await prisma.$disconnect();
})();
