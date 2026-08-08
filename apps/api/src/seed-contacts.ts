const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const cos = await p.company.findMany({ select: { id: true, name: true } });
  const extra = [
    [0, "Maria", "Garcia"], [0, "James", "Wilson"],
    [1, "Robert", "Kim"], [1, "Sarah", "Lee"],
    [2, "Jessica", "Davis"],
    [3, "Thomas", "Mueller"],
    [4, "Pepper", "Potts"], [4, "Happy", "Hogan"],
  ];
  let n = 0;
  for (const [i, first, last] of extra) {
    await p.contact.create({ data: { firstName: first, lastName: last, email: (first.toLowerCase() + "." + last.toLowerCase() + "@" + cos[i].name.toLowerCase().split(" ")[0].replace(/[^a-z]/g, "") + ".com"), companyId: cos[i].id, isPrimary: false } });
    n++;
  }
  console.log("Added " + n + " contacts. Total: " + await p.contact.count());
  await p.$disconnect();
})();
