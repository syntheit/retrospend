# Install dependencies only when needed
FROM node:24-alpine AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.25.0 --activate

# Copy package files, workspace packages and Prisma config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/
COPY prisma/ ./prisma/
# Copy prisma.config.ts
COPY prisma.config.ts ./
COPY scripts/ ./scripts/
COPY patches/ ./patches/

# Install the web app and the workspace packages it uses; other workspace
# projects (apps/mobile) stay out of the image.
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN pnpm install --frozen-lockfile --filter retrospend...

# Rebuild the source code only when needed
FROM node:24-alpine AS builder
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.25.0 --activate

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY . .

# Generate Prisma Client
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN pnpm prisma generate

# Build Next.js
# Set SKIP_ENV_VALIDATION to skip env validation during build
ENV SKIP_ENV_VALIDATION=true
ENV NEXT_TELEMETRY_DISABLED=1

ARG PUBLIC_URL
ENV PUBLIC_URL=${PUBLIC_URL}

ARG SHOW_LANDING_PAGE=false
ENV SHOW_LANDING_PAGE=${SHOW_LANDING_PAGE}

ARG ENABLE_LEGAL_PAGES=false
ENV ENABLE_LEGAL_PAGES=${ENABLE_LEGAL_PAGES}

RUN pnpm build

# Production image, copy all the files and run next
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install pnpm and netcat for database connectivity check
RUN apk add --no-cache netcat-openbsd && \
    corepack enable && corepack prepare pnpm@10.25.0 --activate

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Create uploads directory owned by nextjs user
RUN mkdir -p /data/uploads && chown nextjs:nodejs /data/uploads

# Copy the public folder
COPY --from=builder /app/public ./public

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy Prisma generated client (custom output location)
COPY --from=builder --chown=nextjs:nodejs /app/generated ./generated

# Everything the entrypoint runs while it still holds the database superuser's
# credentials is root-owned and not writable by nextjs: the entrypoint, the
# db-owner scripts and the bootstrap SQL, the Prisma CLI and the node_modules
# they load. The app runs as nextjs, and a container restart keeps its
# writable layer, so code running in the app must not be able to change what
# the next start runs with the superuser's URL in its environment. Copied
# without --chown, then fixed up below.

# Copy node_modules so Prisma CLI is available at runtime
COPY --from=deps /app/node_modules ./node_modules

# Copy package files and Prisma config for runtime operations
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma/ ./prisma/
COPY prisma.config.ts ./
COPY tsconfig.json ./

# Copy scripts directory for runtime operations (the entrypoint runs scripts/db-owner)
COPY scripts/ ./scripts/

# Copy src for runtime scripts (e.g. tsx scripts/*.ts), and the workspace
# packages its re-exports and node_modules links point to
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/packages ./packages

# Copy entrypoint script
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod 755 ./docker-entrypoint.sh

# The standalone copy above made some node_modules directories nextjs-owned,
# and a file or directory may have arrived group or world writable. Fix only
# what is wrong, so the layer stays small. scripts/check-entrypoint-perms.sh
# checks the result inside the built image (src/test/dockerfile-perms.test.ts
# checks this file).
RUN find /app/node_modules /app/prisma /app/scripts /app/package.json \
      /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/prisma.config.ts \
      /app/tsconfig.json /app/docker-entrypoint.sh \
      ! -user root -exec chown -h root:root {} + && \
    find /app/node_modules /app/prisma /app/scripts /app/package.json \
      /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/prisma.config.ts \
      /app/tsconfig.json /app/docker-entrypoint.sh \
      ! -type l \( -perm -020 -o -perm -002 \) -exec chmod go-w {} +

USER nextjs

EXPOSE 1997

ENV PORT=1997
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
