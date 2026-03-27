import type { Metadata } from "next"
import { Badge } from "~/components/ui/badge"
import { Callout } from "../../_components/callout"
import { CodeBlock } from "../../_components/code-block"
import { DocsNav } from "../../_components/docs-nav"
import { getAdjacentDocs } from "../../docs-config"

export const metadata: Metadata = {
	title: "Database",
	description: "PostgreSQL setup, connection pooling, RLS, migrations, and backups.",
}

const slug = "configuration/database"

export default function DatabasePage() {
	const { prev, next } = getAdjacentDocs(slug)

	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">
					Configuration
				</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">Database</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					PostgreSQL setup, connection pooling, Row-Level Security, migrations, and backups.
				</p>
			</div>

			<h2
				id="postgresql"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				PostgreSQL
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Retrospend runs on PostgreSQL 16 with Prisma as the ORM. Prisma handles
				schema management and migrations. The database stores all user data,
				expenses, settings, and audit logs.
			</p>

			<h2
				id="connection-settings"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Connection Settings
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				The default pool uses up to 20 connections with a 30-second idle timeout
				and a 5-second connection timeout. The connection string format
				is{" "}
				<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
					postgresql://user:password@host:5432/database
				</code>
				. When running with Docker Compose, the host is the service name
				(e.g.{" "}
				<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">postgres</code>).
			</p>

			<h2
				id="row-level-security"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Row-Level Security
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Row-Level Security (RLS) is enabled on all user-facing tables. Every
				query is scoped to the current user
				via{" "}
				<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">app.current_user_id</code>,
				set at the start of each request. This means even raw SQL queries cannot
				access another user&#39;s data. RLS policies are defined in the Prisma
				migrations.
			</p>

			<h2
				id="migrations"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Migrations
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Migrations run automatically on startup. For manual migration:
			</p>
			<CodeBlock code={`npx prisma migrate deploy`} lang="bash" />
			<p className="text-muted-foreground leading-relaxed">
				To regenerate the Prisma client after schema changes:
			</p>
			<CodeBlock code={`npx prisma generate`} lang="bash" />
			<Callout variant="info">
				Never edit migration files after they have been applied. Create a new migration instead.
			</Callout>

			<h2
				id="backups"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Backups
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				The sidecar service runs automated database backups on the{" "}
				<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">BACKUP_CRON</code>{" "}
				schedule (default: daily at 3 AM UTC). Old backups are cleaned up
				after{" "}
				<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">BACKUP_RETENTION_DAYS</code>{" "}
				(default: 30 days). To create a manual backup:
			</p>
			<CodeBlock
				code={`docker exec retrospend-postgres pg_dump -U postgres retrospend > backup.sql`}
				lang="bash"
			/>
			<Callout variant="tip">
				Mount a volume to{" "}
				<code className="font-mono text-xs">/app/backups</code> in the sidecar
				container to persist backups on the host.
			</Callout>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
