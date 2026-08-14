// C7NTAX boot-time database backend check.
// Used by startup/c7ntax-boot.ps1 to verify PostgreSQL can actually spawn
// a backend (a listening port alone is not enough after the
// 0xC0000142 / error-487 failure mode).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

prisma.user
  .count()
  .then(() => {
    console.log("DBOK");
    process.exit(0);
  })
  .catch((e: Error) => {
    console.error("DBFAIL", e.message.slice(0, 200));
    process.exit(1);
  });
