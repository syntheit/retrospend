export type DocPage = {
	title: string
	slug: string
	description?: string
}

export type DocSection = {
	title: string
	slug: string
	items: DocPage[]
}

export const DOCS_CONFIG: DocSection[] = [
	{
		title: "Getting Started",
		slug: "getting-started",
		items: [
			{
				title: "Introduction",
				slug: "getting-started",
				description: "What is Retrospend and how to get started",
			},
			{
				title: "Hosted Quick Start",
				slug: "getting-started/quick-start",
				description: "Sign up and start tracking in minutes",
			},
		],
	},
	{
		title: "Features",
		slug: "features",
		items: [
			{ title: "Overview", slug: "features" },
			{ title: "Dashboard", slug: "features/dashboard" },
			{ title: "Budget Tracking", slug: "features/budgets" },
			{ title: "Wealth Tracking", slug: "features/wealth" },
			{ title: "Bank Import", slug: "features/bank-import" },
			{ title: "Shared Expenses", slug: "features/shared-expenses" },
			{ title: "Multi-Currency", slug: "features/multi-currency" },
			{ title: "Recurring Expenses", slug: "features/recurring" },
			{ title: "Transactions", slug: "features/transactions" },
			{ title: "Projects", slug: "features/projects" },
			{ title: "People & Settlements", slug: "features/people" },
			{ title: "Settings", slug: "features/settings" },
		],
	},
	{
		title: "Self-Hosting",
		slug: "self-hosting",
		items: [
			{
				title: "Docker Deployment",
				slug: "self-hosting",
				description: "Run Retrospend on your own server with Docker",
			},
			{
				title: "Reverse Proxy",
				slug: "self-hosting/reverse-proxy",
				description: "Expose Retrospend with Nginx or Caddy",
			},
			{
				title: "Updating",
				slug: "self-hosting/updates",
				description: "Keep your instance up to date",
			},
		],
	},
	{
		title: "Configuration",
		slug: "configuration",
		items: [
			{
				title: "Environment Variables",
				slug: "configuration/environment-variables",
				description: "Full reference for all configuration options",
			},
			{
				title: "Database",
				slug: "configuration/database",
				description: "PostgreSQL setup and tips",
			},
			{
				title: "Storage",
				slug: "configuration/storage",
				description: "Object storage for images and uploads",
			},
			{
				title: "Email (SMTP)",
				slug: "configuration/email",
				description: "Transactional email configuration",
			},
			{
				title: "AI Import (LLM)",
				slug: "configuration/ai-import",
				description: "Local Ollama or OpenRouter setup",
			},
		],
	},
	{
		title: "FAQ",
		slug: "faq",
		items: [
			{
				title: "Frequently Asked Questions",
				slug: "faq",
			},
		],
	},
]

const ALL_PAGES = DOCS_CONFIG.flatMap((s) => s.items)

export function getDocBySlug(slug: string): DocPage | undefined {
	return ALL_PAGES.find((p) => p.slug === slug)
}

export function getAdjacentDocs(slug: string): {
	prev?: DocPage
	next?: DocPage
} {
	const idx = ALL_PAGES.findIndex((p) => p.slug === slug)
	if (idx === -1) return {}
	return {
		prev: ALL_PAGES[idx - 1],
		next: ALL_PAGES[idx + 1],
	}
}
