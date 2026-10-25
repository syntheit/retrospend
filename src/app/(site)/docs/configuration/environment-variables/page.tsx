import type { Metadata } from "next"
import { Badge } from "~/components/ui/badge"
import { Callout } from "../../_components/callout"
import { CodeBlock } from "../../_components/code-block"
import { DocsNav } from "../../_components/docs-nav"
import { getAdjacentDocs } from "../../docs-config"

export const metadata: Metadata = {
	title: "Environment Variables",
	description: "Full reference for all Retrospend configuration options.",
}

const slug = "configuration/environment-variables"

type EnvVar = {
	name: string
	required: boolean
	default?: string
	description: string
}

type EnvGroup = {
	title: string
	id: string
	vars: EnvVar[]
}

const ENV_GROUPS: EnvGroup[] = [
	{
		title: "Core",
		id: "core",
		vars: [
			{
				name: "AUTH_SECRET",
				required: true,
				description:
					"Secret used to sign sessions and auth tokens. Generate with: openssl rand -base64 32",
			},
			{
				name: "PUBLIC_URL",
				required: true,
				description:
					"Full public URL of your instance (e.g. https://your-domain.com). Used for auth redirects and email links.",
			},
			{
				name: "DATABASE_URL",
				required: true,
				description:
					"PostgreSQL connection string. In Docker: postgresql://user:pass@postgres:5432/retrospend",
			},
			{
				name: "TRUSTED_ORIGINS",
				required: false,
				description:
					"Comma-separated list of additional origins to trust for auth requests. Useful for tunnel setups.",
			},
		],
	},
	{
		title: "Database",
		id: "database",
		vars: [
			{
				name: "POSTGRES_USER",
				required: true,
				default: "postgres",
				description: "PostgreSQL username.",
			},
			{
				name: "POSTGRES_PASSWORD",
				required: true,
				description: "PostgreSQL password. Use a strong random value.",
			},
			{
				name: "POSTGRES_DB_NAME",
				required: true,
				default: "retrospend",
				description: "PostgreSQL database name.",
			},
		],
	},
	{
		title: "Sidecar",
		id: "sidecar",
		vars: [
			{
				name: "WORKER_API_KEY",
				required: true,
				description:
					"Shared secret between the main app and the sidecar. Generate with: openssl rand -base64 32",
			},
			{
				name: "SIDECAR_URL",
				required: false,
				default: "http://retrospend-sidecar:8080",
				description: "Internal URL of the sidecar service (background jobs + importer).",
			},
		],
	},
	{
		title: "Storage",
		id: "storage",
		vars: [
			{
				name: "UPLOAD_DIR",
				required: false,
				default: "/data/uploads",
				description:
					"Directory path for uploaded files. Mounted as a Docker volume.",
			},
		],
	},
	{
		title: "AI Import (LLM)",
		id: "ai-import",
		vars: [
			{
				name: "OPENROUTER_API_KEY",
				required: false,
				description:
					"OpenRouter API key. Required if using external AI for bank import. Get one at openrouter.ai",
			},
			{
				name: "OPENROUTER_MODEL",
				required: false,
				default: "qwen/qwen-2.5-7b-instruct",
				description: "OpenRouter model to use for import processing.",
			},
			{
				name: "OLLAMA_ENDPOINT",
				required: false,
				default: "http://ollama:11434/api/generate",
				description:
					"Ollama API endpoint. Use http://host.docker.internal:11434/api/generate if Ollama runs on the host.",
			},
			{
				name: "LLM_MODEL",
				required: false,
				default: "qwen2.5:7b",
				description: "Ollama model name. Must be pulled first.",
			},
			{
				name: "ENRICH_BATCH_SIZE",
				required: false,
				default: "20",
				description: "Merchants per LLM enrichment batch.",
			},
			{
				name: "ENRICH_CONCURRENCY",
				required: false,
				default: "3",
				description: "Max parallel enrichment LLM calls.",
			},
			{
				name: "PDF_CONCURRENCY",
				required: false,
				default: "3",
				description: "Max parallel PDF chunk parsing LLM calls.",
			},
		],
	},
	{
		title: "Email (SMTP)",
		id: "email",
		vars: [
			{
				name: "SMTP_HOST",
				required: false,
				description: "SMTP server hostname.",
			},
			{
				name: "SMTP_PORT",
				required: false,
				default: "587",
				description: "SMTP server port.",
			},
			{
				name: "SMTP_USER",
				required: false,
				description: "SMTP authentication username.",
			},
			{
				name: "SMTP_PASSWORD",
				required: false,
				description: "SMTP authentication password.",
			},
			{
				name: "EMAIL_FROM",
				required: false,
				description:
					'From address for outgoing emails. Example: Retrospend <noreply@your-domain.com>',
			},
			{
				name: "UNSUBSCRIBE_SECRET",
				required: false,
				description:
					"Secret used to sign one-click unsubscribe links in notification emails. Generate with: openssl rand -base64 32",
			},
		],
	},
	{
		title: "App Behavior",
		id: "app",
		vars: [
			{
				name: "NEXT_PUBLIC_SHOW_LANDING_PAGE",
				required: false,
				default: "true",
				description: "Show the marketing landing page at /",
			},
			{
				name: "NEXT_PUBLIC_ENABLE_LEGAL_PAGES",
				required: false,
				default: "false",
				description: "Show Terms and Privacy Policy links in the UI.",
			},
		],
	},
]

function EnvTable({ vars }: { vars: EnvVar[] }) {
	return (
		<div className="my-4 overflow-x-auto rounded-lg border border-border">
			<table className="w-full text-sm">
				<thead>
					<tr className="border-b border-border bg-muted/30">
						<th className="px-4 py-2.5 text-left font-semibold text-xs">Variable</th>
						<th className="px-4 py-2.5 text-left font-semibold text-xs">Required</th>
						<th className="px-4 py-2.5 text-left font-semibold text-xs">Default</th>
						<th className="px-4 py-2.5 text-left font-semibold text-xs">Description</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-border">
					{vars.map((v) => (
						<tr key={v.name}>
							<td className="px-4 py-3 font-mono text-xs font-semibold">
								{v.name}
							</td>
							<td className="px-4 py-3">
								{v.required ? (
									<Badge variant="destructive" className="text-xs">required</Badge>
								) : (
									<Badge variant="secondary" className="text-xs">optional</Badge>
								)}
							</td>
							<td className="px-4 py-3 font-mono text-muted-foreground text-xs">
								{v.default ?? "-"}
							</td>
							<td className="px-4 py-3 text-muted-foreground text-xs leading-relaxed">
								{v.description}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

export default function EnvVarsPage() {
	const { prev, next } = getAdjacentDocs(slug)

	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">
					Configuration
				</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">
					Environment Variables
				</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					Full reference for all Retrospend environment variables. These are set
					in your <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">.env</code> file.
					Some operational settings (audit log privacy mode, import concurrency,
					AI configuration, and registration controls) are managed at runtime via
					the Admin Panel instead.
				</p>
			</div>

			<Callout variant="info">
				The{" "}
				<code className="font-mono text-xs">.env.example</code> file in the
				repository contains all variables with comments. Copy it to{" "}
				<code className="font-mono text-xs">.env</code> and fill in your values.
			</Callout>

			<CodeBlock
				code={`cp .env.example .env
# Then edit .env with your values`}
				lang="bash"
			/>

			{ENV_GROUPS.map((group) => (
				<section key={group.id}>
					<h2
						id={group.id}
						className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
					>
						{group.title}
					</h2>
					<EnvTable vars={group.vars} />
				</section>
			))}

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
