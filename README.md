# C7NTAX — PSA Platform

Syntax refers to the rules that govern structured language and code. It positions C7NTAX as the "correct grammar" for how a modern, secure MSP should operate.
 
Every MSP runs on code, workflows, and communication. But without clear alignment, operations will often break down.
C7NTAX (pronounced syntax) is the intelligent PSA solution designed to bring perfect structure to your service delivery. Built with a security-first architecture and deep automation at its core, C7NTAX bridges the gap between client ticketing, SLA tracking, automated billing, and resource management.
By standardizing your daily operations into a single, cohesive workflow engine, C7NTAX minimizes manual overhead, accelerates response times, and gives MSP leadership complete visibility into profitability and team utilization.
Stop wrestling with fragmented tools and rigid legacy software. Speak the language of high-efficiency MSP operations with C7NTAX.

## Architecture

```
C7NTAX/
├── apps/
│   ├── api/          # Express + TypeScript REST API
│   ├── web/          # React + Vite + Tailwind CSS
│   └── desktop/      # Electron desktop wrapper
├── packages/
│   ├── shared/       # Shared types, schemas, constants
│   ├── email/        # Email sending, templates, ingestion
│   ├── billing/      # Service agreements, invoicing, payments
│   └── integrations/ # Third-party API connectors
├── docs/             # OpenAPI spec, architecture docs
└── scripts/          # Devops and utility scripts
```

## Tech Stack

| Layer          | Technology                              |
|----------------|------------------------------------------|
| Frontend       | React 18, TypeScript, Tailwind CSS, Vite |
| Backend        | Node.js 20, Express, TypeScript          |
| Database       | PostgreSQL 16 + Prisma ORM               |
| Auth           | JWT + TOTP (authenticator) + Email MFA   |
| Email          | Nodemailer + MJML templates              |
| Desktop        | Electron 30                              |
| Integrations   | REST/SOAP SDKs per service               |
| Real-time      | WebSocket (ws)                           |
| Background Jobs| BullMQ + Redis                           |

## Getting Started

```bash
pnpm install
pnpm db:generate
pnpm db:push
pnpm dev
```

## License

Proprietary — Cyber 7 Group
