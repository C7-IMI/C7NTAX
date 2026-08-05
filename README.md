# C7 Overwatch — PSA Platform

A full-stack Professional Services Automation platform replicating the interface and core functionality of AutoTask PSA, tailored for Cyber 7 Group.

## Architecture

```
c7-overwatch/
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
