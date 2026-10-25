import type { Metadata } from "next"
import Link from "next/link"
import { Badge } from "~/components/ui/badge"
import { DocItem } from "../_components/doc-item"
import { DocsNav } from "../_components/docs-nav"
import { getAdjacentDocs } from "../docs-config"

export const metadata: Metadata = {
	title: "Features Overview",
	description: "Overview of all Retrospend features.",
}

const slug = "features"

const FEATURES = [
	{
		title: "Dashboard",
		slug: "features/dashboard",
		desc: "Monthly spending overview, category breakdown, and recent transactions.",
	},
	{
		title: "Budget Tracking",
		slug: "features/budgets",
		desc: "Set monthly budgets per category. See daily safe-to-spend in real time.",
	},
	{
		title: "Wealth Tracking",
		slug: "features/wealth",
		desc: "Log assets and liabilities. Track net worth and financial runway over time.",
	},
	{
		title: "Bank Import",
		slug: "features/bank-import",
		desc: "Import CSV, PDF, or XLSX from your bank. AI categorizes transactions automatically.",
	},
	{
		title: "Shared Expenses",
		slug: "features/shared-expenses",
		desc: "Split bills, track balances, and settle up with others.",
	},
	{
		title: "Multi-Currency",
		slug: "features/multi-currency",
		desc: "Full fiat and crypto support with parallel market exchange rates.",
	},
	{
		title: "Recurring Expenses",
		slug: "features/recurring",
		desc: "Templates for subscriptions and bills. Generated automatically on schedule.",
	},
	{
		title: "Transactions",
		slug: "features/transactions",
		desc: "Search, filter, bulk edit, and export your full expense history.",
	},
	{
		title: "Projects",
		slug: "features/projects",
		desc: "Group shared expenses into trips, households, or any ongoing group.",
	},
	{
		title: "People & Settlements",
		slug: "features/people",
		desc: "Manage contacts, track balances per person, and settle debts.",
	},
	{
		title: "Settings",
		slug: "features/settings",
		desc: "Profile, security, payment methods, notifications, and data management.",
	},
]

export default function FeaturesPage() {
	const { prev, next } = getAdjacentDocs(slug)

	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">
					Features
				</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">
					Features Overview
				</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					Everything Retrospend can do. Explore the features in detail.
				</p>
			</div>

			<div className="mt-8 grid gap-3 sm:grid-cols-2">
				{FEATURES.map((f) => (
					<Link
						className="rounded-ctl focus-visible:outline-brand can-hover:hover:underline block focus-visible:outline-2 focus-visible:outline-offset-2"
						key={f.slug}
						href={`/docs/${f.slug}`}
					>
						<DocItem title={f.title}>{f.desc}</DocItem>
					</Link>
				))}
			</div>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
