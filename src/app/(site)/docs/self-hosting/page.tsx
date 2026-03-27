import type { Metadata } from "next"
import Link from "next/link"
import { Badge } from "~/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs"
import { Callout } from "../_components/callout"
import { CodeBlock } from "../_components/code-block"
import { DocsNav } from "../_components/docs-nav"
import { getAdjacentDocs } from "../docs-config"

export const metadata: Metadata = {
	title: "Docker Deployment",
	description:
		"Deploy Retrospend on your own server using Docker Compose.",
}

const slug = "self-hosting"

const DOCKER_COMPOSE_MINIMAL = `services:
  retrospend:
    image: synzeit/retrospend:latest
    container_name: retrospend
    restart: unless-stopped
    environment:
      AUTH_SECRET: \${AUTH_SECRET}
      DATABASE_URL: "postgresql://\${POSTGRES_USER}:\${POSTGRES_PASSWORD}@postgres:5432/\${POSTGRES_DB_NAME}"
      PUBLIC_URL: "https://your-domain.com"
      WORKER_API_KEY: \${WORKER_API_KEY}
      SIDECAR_URL: "http://sidecar:8080"
    ports:
      - "1997:1997"
    volumes:
      - uploads:/data/uploads
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:16-alpine
    container_name: retrospend-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: \${POSTGRES_DB_NAME}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  sidecar:
    image: synzeit/retrospend-sidecar:latest
    container_name: retrospend-sidecar
    restart: unless-stopped
    environment:
      DATABASE_URL: "postgresql://\${POSTGRES_USER}:\${POSTGRES_PASSWORD}@postgres:5432/\${POSTGRES_DB_NAME}"
      WORKER_API_KEY: \${WORKER_API_KEY}
      LOG_LEVEL: "info"
      BACKUP_DIR: "/backups"
      BACKUP_RETENTION_DAYS: "\${BACKUP_RETENTION_DAYS:-30}"
      BACKUP_CRON: "\${BACKUP_CRON:-0 3 * * *}"
      OPENROUTER_API_KEY: \${OPENROUTER_API_KEY:-}
      OPENROUTER_MODEL: \${OPENROUTER_MODEL:-qwen/qwen-2.5-7b-instruct}
      ENRICH_BATCH_SIZE: "\${ENRICH_BATCH_SIZE:-20}"
      ENRICH_CONCURRENCY: "\${ENRICH_CONCURRENCY:-3}"
      PDF_CONCURRENCY: "\${PDF_CONCURRENCY:-3}"
    volumes:
      - backup_data:/backups
      - sidecar_data:/app/data
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres_data:
  uploads:
  sidecar_data:
  backup_data:`

const DOCKER_COMPOSE_WITH_OLLAMA = `services:
  retrospend:
    image: synzeit/retrospend:latest
    container_name: retrospend
    restart: unless-stopped
    environment:
      AUTH_SECRET: \${AUTH_SECRET}
      DATABASE_URL: "postgresql://\${POSTGRES_USER}:\${POSTGRES_PASSWORD}@postgres:5432/\${POSTGRES_DB_NAME}"
      PUBLIC_URL: "https://your-domain.com"
      WORKER_API_KEY: \${WORKER_API_KEY}
      SIDECAR_URL: "http://sidecar:8080"
    ports:
      - "1997:1997"
    volumes:
      - uploads:/data/uploads
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:16-alpine
    container_name: retrospend-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: \${POSTGRES_DB_NAME}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  sidecar:
    image: synzeit/retrospend-sidecar:latest
    container_name: retrospend-sidecar
    restart: unless-stopped
    environment:
      DATABASE_URL: "postgresql://\${POSTGRES_USER}:\${POSTGRES_PASSWORD}@postgres:5432/\${POSTGRES_DB_NAME}"
      WORKER_API_KEY: \${WORKER_API_KEY}
      LOG_LEVEL: "info"
      BACKUP_DIR: "/backups"
      BACKUP_RETENTION_DAYS: "\${BACKUP_RETENTION_DAYS:-30}"
      BACKUP_CRON: "\${BACKUP_CRON:-0 3 * * *}"
      OLLAMA_ENDPOINT: \${OLLAMA_ENDPOINT:-http://ollama:11434/api/generate}
      LLM_MODEL: \${LLM_MODEL:-qwen2.5:7b}
      ENRICH_BATCH_SIZE: "\${ENRICH_BATCH_SIZE:-20}"
      ENRICH_CONCURRENCY: "\${ENRICH_CONCURRENCY:-3}"
      PDF_CONCURRENCY: "\${PDF_CONCURRENCY:-3}"
    volumes:
      - backup_data:/backups
      - sidecar_data:/app/data
    depends_on:
      postgres:
        condition: service_healthy

  ollama:
    image: ollama/ollama:latest
    container_name: local-ollama
    restart: unless-stopped
    volumes:
      - ollama_data:/root/.ollama
    # Uncomment for NVIDIA GPU support:
    # devices:
    #   - nvidia.com/gpu=all

volumes:
  postgres_data:
  uploads:
  ollama_data:
  sidecar_data:
  backup_data:`

const ENV_FILE = `# Generate with: openssl rand -base64 32
AUTH_SECRET=""

PUBLIC_URL="https://your-domain.com"

# Database
POSTGRES_PASSWORD="changeme"
POSTGRES_USER="postgres"
POSTGRES_DB_NAME="retrospend"

# Worker
WORKER_API_KEY="your-worker-api-key"

# AI Import - pick one:
# Option A: OpenRouter (external, recommended for most users)
# OPENROUTER_API_KEY=""
# OPENROUTER_MODEL="qwen/qwen-2.5-7b-instruct"

# Option B: Local Ollama (see docker-compose.local-ai.yml)
# LLM_MODEL="qwen2.5:7b"

# Optional: email notifications
# SMTP_HOST=""
# SMTP_PORT=587
# SMTP_USER=""
# SMTP_PASSWORD=""
# EMAIL_FROM="Retrospend <noreply@your-domain.com>"
# UNSUBSCRIBE_SECRET=""  # Generate with: openssl rand -base64 32`

export default function SelfHostingPage() {
	const { prev, next } = getAdjacentDocs(slug)

	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">
					Self-Hosting
				</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">
					Docker Deployment
				</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					Deploy Retrospend on your own server using Docker Compose. This is
					the recommended and officially supported self-hosting method.
				</p>
			</div>

			<h2 id="prerequisites" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Prerequisites
			</h2>
			<ul className="space-y-2 text-muted-foreground text-sm leading-relaxed">
				<li>
					•{" "}
					<strong className="text-foreground">Docker Engine 24+</strong> and{" "}
					<strong className="text-foreground">Docker Compose v2</strong>{" "}
					installed
				</li>
				<li>
					• A server or VPS with at least{" "}
					<strong className="text-foreground">1 GB RAM</strong> (2 GB+ recommended
					if using local Ollama)
				</li>
				<li>
					• A domain name pointed at your server (for HTTPS via a reverse proxy)
				</li>
				<li>
					• Ports <strong className="text-foreground">80</strong> and{" "}
					<strong className="text-foreground">443</strong> available (if using
					Caddy or Nginx for TLS)
				</li>
			</ul>

			<Callout variant="info" title="AI import is optional">
				The bank statement import feature requires an LLM (local Ollama or
				OpenRouter). If you don&apos;t plan to use it, simply omit the LLM
				environment variables from the sidecar service.
			</Callout>

			<h2 id="setup" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Setup
			</h2>

			<h3 id="step-1-env-file" className="mt-6 mb-3 font-semibold text-base scroll-mt-20">
				Step 1: Create your .env file
			</h3>
			<p className="mb-3 text-muted-foreground text-sm leading-relaxed">
				Create a <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">.env</code>{" "}
				file in your deployment directory:
			</p>
			<CodeBlock code={ENV_FILE} filename=".env" />
			<Callout variant="warning" title="Generate strong secrets">
				Run{" "}
				<code className="font-mono text-xs">openssl rand -base64 32</code> for
				each secret value. Never reuse secrets across services.
			</Callout>

			<h3 id="step-2-compose-file" className="mt-8 mb-3 font-semibold text-base scroll-mt-20">
				Step 2: Choose your docker-compose.yml
			</h3>
			<p className="mb-4 text-muted-foreground text-sm leading-relaxed">
				Pick the variant that matches your setup:
			</p>

			<Tabs defaultValue="openrouter">
				<TabsList className="mb-1">
					<TabsTrigger value="openrouter">OpenRouter (recommended)</TabsTrigger>
					<TabsTrigger value="ollama">Local Ollama</TabsTrigger>
				</TabsList>

				<TabsContent value="openrouter">
					<p className="mb-3 text-muted-foreground text-sm">
						Uses{" "}
						<a
							href="https://openrouter.ai"
							target="_blank"
							rel="noopener noreferrer"
							className="text-primary underline underline-offset-4"
						>
							OpenRouter
						</a>{" "}
						for AI-powered bank import. Requires an API key but no GPU. The free
						tier is sufficient for most personal use.
					</p>
					<CodeBlock
						code={DOCKER_COMPOSE_MINIMAL}
						filename="docker-compose.yml"
						lang="yaml"
					/>
				</TabsContent>

				<TabsContent value="ollama">
					<p className="mb-3 text-muted-foreground text-sm">
						Runs a local Ollama instance for fully offline AI import. Requires
						more RAM (4 GB+ for the model). GPU support is available for NVIDIA
						cards.
					</p>
					<CodeBlock
						code={DOCKER_COMPOSE_WITH_OLLAMA}
						filename="docker-compose.yml"
						lang="yaml"
					/>
					<Callout variant="tip">
						After first start, pull the model:{" "}
						<code className="font-mono text-xs">
							docker exec local-ollama ollama pull qwen2.5:7b
						</code>
					</Callout>
				</TabsContent>
			</Tabs>

			<h3 id="step-3-start" className="mt-8 mb-3 font-semibold text-base scroll-mt-20">
				Step 3: Start the stack
			</h3>
			<CodeBlock
				code={`docker compose up -d`}
				lang="bash"
			/>
			<p className="mt-3 text-muted-foreground text-sm leading-relaxed">
				The first start will pull images and run database migrations
				automatically. Check logs with:
			</p>
			<CodeBlock code={`docker compose logs -f retrospend`} lang="bash" />

			<h3 id="step-4-access" className="mt-8 mb-3 font-semibold text-base scroll-mt-20">
				Step 4: Access your instance
			</h3>
			<p className="text-muted-foreground text-sm leading-relaxed">
				Retrospend listens on port{" "}
				<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">1997</code>.
				You can access it directly at{" "}
				<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
					http://your-server:1997
				</code>{" "}
				or put it behind a reverse proxy for HTTPS. See the{" "}
				<Link
					href="/docs/self-hosting/reverse-proxy"
					className="text-primary underline underline-offset-4"
				>
					Reverse Proxy guide
				</Link>{" "}
				for Nginx and Caddy configuration.
			</p>

			<h2 id="services" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Services Overview
			</h2>
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-border">
							<th className="pb-2 text-left font-semibold">Service</th>
							<th className="pb-2 text-left font-semibold">Image</th>
							<th className="pb-2 text-left font-semibold">Purpose</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-border text-muted-foreground">
						{[
							["retrospend", "synzeit/retrospend", "Main web app (Next.js)"],
							["postgres", "postgres:16-alpine", "Primary database"],
							["sidecar", "synzeit/retrospend-sidecar", "Background jobs + AI bank import"],
							["ollama", "ollama/ollama", "Local LLM (optional)"],
						].map(([name, image, purpose]) => (
							<tr key={name}>
								<td className="py-2.5 pr-4 font-mono text-xs">{name}</td>
								<td className="py-2.5 pr-4 font-mono text-xs">{image}</td>
								<td className="py-2.5">{purpose}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<h2 id="data-persistence" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Data Persistence
			</h2>
			<p className="text-muted-foreground text-sm leading-relaxed">
				All data is stored in named Docker volumes:{" "}
				<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">postgres_data</code>{" "}
				for the database and{" "}
				<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">uploads</code>{" "}
				for uploaded files (avatars, project images, receipts). Back these up
				regularly, as they contain all your financial data.
			</p>
			<CodeBlock
				code={`# Backup PostgreSQL
docker exec retrospend-postgres pg_dump -U postgres retrospend > backup.sql

# List volumes
docker volume ls | grep retrospend`}
				lang="bash"
			/>

			<h2 id="first-user" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				First User & Registration
			</h2>
			<p className="text-muted-foreground text-sm leading-relaxed">
				On a fresh instance, navigate to{" "}
				<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
					/signup
				</code>{" "}
				to create your account. The first registered user can be promoted to
				admin from the admin panel at{" "}
				<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
					/admin
				</code>
				.
			</p>
			<Callout variant="info">
				To disable public registration after setup, you can remove the signup
				route or restrict access at the reverse proxy level.
			</Callout>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
