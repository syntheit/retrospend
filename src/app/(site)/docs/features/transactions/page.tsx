import type { Metadata } from "next"
import { Badge } from "~/components/ui/badge"
import { Card, CardContent } from "~/components/ui/card"
import { Callout } from "../../_components/callout"
import { DocsNav } from "../../_components/docs-nav"
import { getAdjacentDocs } from "../../docs-config"

export const metadata: Metadata = {
	title: "Transactions",
	description: "Search, filter, and manage your full expense history.",
}

const slug = "features/transactions"

export default function TransactionsPage() {
	const { prev, next } = getAdjacentDocs(slug)
	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">Features</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">Transactions</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					The transactions page is your complete expense history. Search, filter, sort, and
					take bulk actions on any set of transactions.
				</p>
			</div>

			<h2 id="data-table" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Data Table
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Built on TanStack Table. Columns include date, title, amount (in original currency and
				home currency), category, and type. Click any column header to sort. Click any row to
				edit the expense.
			</p>

			<h2 id="filters" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Filters
			</h2>
			<div className="grid gap-3 sm:grid-cols-2">
				{[
					{ title: "Date", desc: "Filter by year, month, or a custom date range." },
					{ title: "Amount", desc: "Set a minimum and maximum amount to narrow results." },
					{ title: "Categories", desc: "Multi-select picker. Show only specific categories." },
					{ title: "Type", desc: "Filter by personal or shared expenses." },
				].map((card) => (
					<Card key={card.title} className="border-border bg-card">
						<CardContent className="p-4">
							<p className="font-semibold text-sm">{card.title}</p>
							<p className="mt-1 text-muted-foreground text-sm">{card.desc}</p>
						</CardContent>
					</Card>
				))}
			</div>

			<h2 id="search" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Search
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Full-text search across transaction titles. Results update as you type.
			</p>

			<h2 id="bulk-actions" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Bulk Actions
			</h2>
			<p className="mb-4 text-muted-foreground leading-relaxed">
				Select multiple transactions using the checkboxes. Actions available:
			</p>
			<div className="grid gap-3 sm:grid-cols-3">
				{[
					{ title: "Delete", desc: "Remove selected transactions permanently." },
					{ title: "Export CSV", desc: "Download selected transactions as a CSV file." },
					{ title: "Recategorize", desc: "Change the category for all selected transactions at once." },
				].map((card) => (
					<Card key={card.title} className="border-border bg-card">
						<CardContent className="p-4">
							<p className="font-semibold text-sm">{card.title}</p>
							<p className="mt-1 text-muted-foreground text-sm">{card.desc}</p>
						</CardContent>
					</Card>
				))}
			</div>

			<h2 id="shared-indicators" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Shared Indicators
			</h2>
			<p className="mb-3 text-muted-foreground leading-relaxed">
				Shared expenses show extra details in the table:
			</p>
			<ul className="mb-4 list-disc space-y-1.5 pl-6 text-muted-foreground text-sm leading-relaxed">
				<li>Source badge showing the project name (if any).</li>
				<li>Total amount and your share.</li>
				<li>Participant count.</li>
				<li>Status badges: Active, Pending, Disputed, Settled.</li>
			</ul>

			<h2 id="edited-indicator" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Edited Indicator
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Transactions that have been edited show a revision count and an amber dot for changes
				you haven&apos;t seen yet. Click the indicator to open the revision history drawer.
			</p>

			<h2 id="exclude-from-analytics" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Exclude from Analytics
			</h2>
			<p className="mb-4 text-muted-foreground leading-relaxed">
				Toggle &quot;exclude from analytics&quot; on any expense to remove it from dashboard totals,
				budgets, and trend calculations. The transaction stays in your history but doesn&apos;t
				affect your numbers.
			</p>
			<Callout variant="tip" title="When to exclude">
				Use this for one-off purchases (a laptop, a security deposit) that would skew your
				monthly spending patterns.
			</Callout>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
