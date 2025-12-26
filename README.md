# Retrospend

Retrospend is a personal finance and expense tracker application. It helps you manage your expenses, track your wealth, and handle multi-currency transactions with exchange rate integration.

## Features

- Expense tracking with categorization
- Wealth management and asset tracking
- Multi-currency support with exchange rates (data from [syntheit/exchange-rates](https://github.com/syntheit/exchange-rates))
- Analytics and charts
- Admin panel for user management
- Secure authentication

## Tech Stack

- Next.js (App Router)
- React
- Tailwind CSS
- Prisma
- PostgreSQL
- Better Auth
- tRPC

## Prerequisites

- Docker and Docker Compose
- pnpm (for local development)

## Getting Started

### Environment Setup

Create a `.env` file in the root directory. You can use the following example:

```env
# Database
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password
POSTGRES_DB_NAME=retrospend
DATABASE_URL=postgresql://postgres:password@localhost:5432/retrospend

# Generate a secret using openssl rand -base64 32
AUTH_SECRET=your-secret-key-min-32-chars

# App Config
EXCHANGE_RATE_SCHEDULER_ENABLED=true
SHOW_LANDING_PAGE=true
PUBLIC_URL=https://www.yourdomain.com
```

### Running with Docker

1. Create the `docker-compose.yml` file in your project root:

```yaml
services:
  retrospend:
    image: synzeit/retrospend:latest
    container_name: retrospend
    restart: unless-stopped
    environment:
      AUTH_SECRET: ${AUTH_SECRET}
      DATABASE_URL: "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB_NAME}"
      EXCHANGE_RATE_SCHEDULER_ENABLED: "true"
      SHOW_LANDING_PAGE: "true"
    ports:
      - "1997:1997"

  postgres:
    image: postgres:16-alpine
    container_name: retrospend-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB_NAME}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
    driver: local
```

2. Start the services:

```bash
docker compose up -d
```

3. The application is now ready.

**Note:** The first user to sign up will automatically be made an admin. You can limit signups to only those with an invite code in the admin panel if you choose.

## Community

Join our Matrix room for discussions, support, and updates: [#retrospend:matrix.org](https://matrix.to/#/#retrospend:matrix.org)
