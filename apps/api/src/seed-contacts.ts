const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  const cos = await p.company.findMany({ select: { id: true, name: true } });
  console.log("Companies:", cos.length);
  await p.contact.deleteMany();
  
  const contacts = [
    { companyId: cos[0].id, firstName: "David", lastName: "Chen", email: "david@acmecorp.com", phone: "+1-555-0101", mobile: "+1-555-0111", title: "IT Director", department: "Information Technology", isPrimary: true, isActive: true, notes: "Primary IT contact. M-F 9-5 EST." },
    { companyId: cos[0].id, firstName: "Maria", lastName: "Garcia", email: "maria@acmecorp.com", phone: "+1-555-0102", mobile: "+1-555-0112", title: "HR Manager", department: "Human Resources", isPrimary: false, isActive: true, notes: "" },
    { companyId: cos[0].id, firstName: "James", lastName: "Wilson", email: "jwilson@acmecorp.com", phone: "+1-555-0103", title: "CFO", department: "Finance", isPrimary: false, isActive: true, notes: "Handles billing and invoice approvals." },
    { companyId: cos[1].id, firstName: "Emily", lastName: "Johnson", email: "emily@globexind.com", phone: "+1-555-0201", mobile: "+1-555-0211", title: "VP Operations", department: "Operations", isPrimary: true, isActive: true, notes: "Emergency contact after hours." },
    { companyId: cos[1].id, firstName: "Robert", lastName: "Kim", email: "rkim@globexind.com", phone: "+1-555-0202", title: "Network Admin", department: "IT", isPrimary: false, isActive: true, notes: "" },
    { companyId: cos[1].id, firstName: "Sarah", lastName: "Lee", email: "slee@globexind.com", phone: "+1-555-0203", mobile: "+1-555-0213", title: "Office Manager", department: "Administration", isPrimary: false, isActive: true, notes: "Key holder for Chicago office." },
    { companyId: cos[2].id, firstName: "Michael", lastName: "Brown", email: "mbrown@initech.io", phone: "+1-555-0301", title: "CEO", department: "Executive", isPrimary: true, isActive: true, notes: "Decision maker for major contracts." },
    { companyId: cos[2].id, firstName: "Jessica", lastName: "Davis", email: "jdavis@initech.io", phone: "+1-555-0302", mobile: "+1-555-0312", title: "CTO", department: "Engineering", isPrimary: false, isActive: true, notes: "Technical contact for projects." },
    { companyId: cos[3].id, firstName: "Alice", lastName: "Wong", email: "alice@umbrellacorp.net", phone: "+1-555-0401", title: "Security Officer", department: "Security", isPrimary: true, isActive: true, notes: "Manages security incidents and access requests." },
    { companyId: cos[3].id, firstName: "Thomas", lastName: "Mueller", email: "tmueller@umbrellacorp.net", phone: "+1-555-0402", mobile: "+1-555-0412", title: "IT Manager", department: "IT", isPrimary: false, isActive: true, notes: "" },
    { companyId: cos[4].id, firstName: "Tony", lastName: "Stark", email: "tony@starkent.com", phone: "+1-555-0501", mobile: "+1-555-0511", title: "Owner", department: "Executive", isPrimary: true, isActive: true, notes: "VIP client — priority handling for all requests." },
    { companyId: cos[4].id, firstName: "Pepper", lastName: "Potts", email: "pepper@starkent.com", phone: "+1-555-0502", mobile: "+1-555-0512", title: "Operations Director", department: "Operations", isPrimary: false, isActive: true, notes: "Handles day-to-day requests and procurement." },
    { companyId: cos[4].id, firstName: "Happy", lastName: "Hogan", email: "happy@starkent.com", phone: "+1-555-0503", title: "Facilities Manager", department: "Facilities", isPrimary: false, isActive: true, notes: "On-site contact for physical access." },
  ];
  
  for (const c of contacts) {
    await p.contact.create({ data: c });
  }
  
  const count = await p.contact.count();
  console.log("Seeded " + count + " contacts with full PSA fields");
  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
