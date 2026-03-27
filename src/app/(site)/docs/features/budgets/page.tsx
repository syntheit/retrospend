import type { Metadata } from "next"
import { Badge } from "~/components/ui/badge"
import { Card, CardContent } from "~/components/ui/card"
import { Callout } from "../../_components/callout"
import { BudgetDemoEmbed } from "../../_components/demo-embeds"
import { DocsNav } from "../../_components/docs-nav"
import { getAdjacentDocs } from "../../docs-config"

export const metadata: Metadata = {
	title: "Budgets",
	description: "Set spending limits and track real-time budget pacing.",
}

const slug = "features/budgets"

export default function BudgetsPage() {
	const { prev, next } = getAdjacentDocs(slug)
	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">Features</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">Budget Tracking</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					Set per-category spending limits and see exactly where you stand at any point in the month.
				</p>
			</div>

			<BudgetDemoEmbed />

			<h2 id="how-budgets-work" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				How Budgets Work
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Each category in your budget has a monthly spending limit. As you log expenses, Retrospend
				tracks actual spend against the limit in real time. The partition bar at the top shows
				how your total budget is allocated across categories, and each category row includes a
				bullet chart showing spend vs. limit.
			</p>

			<h2 id="variable-vs-fixed" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Variable vs Fixed Categories
			</h2>
			<p className="mb-4 text-muted-foreground leading-relaxed">
				Budget categories are split into two groups:
			</p>
			<div className="grid gap-3 sm:grid-cols-2">
				<Card className="border-border bg-card">
					<CardContent className="p-4">
						<p className="font-semibold text-sm">Variable / Managed</p>
						<p className="mt-1 text-muted-foreground text-sm">
							Categories where you actively control spending: groceries, dining, entertainment.
							You set a target limit and Retrospend calculates a daily safe-to-spend pace.
						</p>
					</CardContent>
				</Card>
				<Card className="border-border bg-card">
					<CardContent className="p-4">
						<p className="font-semibold text-sm">Fixed / Pegged to Actual</p>
						<p className="mt-1 text-muted-foreground text-sm">
							Categories with predictable costs: rent, subscriptions, insurance. Toggle
							&quot;Peg to actual&quot; and the budget automatically matches what you spend,
							keeping the focus on variable categories.
						</p>
					</CardContent>
				</Card>
			</div>

			<h2 id="key-features" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Key Features
			</h2>
			<div className="grid gap-3 sm:grid-cols-3">
				{[
					{
						title: "Partition Bar",
						desc: "A proportional bar at the top showing how your total budget is divided across all categories.",
					},
					{
						title: "Bullet Charts",
						desc: "Each category row has a horizontal bullet chart: a bar for actual spend against the target limit marker.",
					},
					{
						title: "Copy from Last Month",
						desc: "Start a new month by copying last month's budget allocation with one click, then adjust as needed.",
					},
				].map((f) => (
					<Card key={f.title} className="border-border bg-card">
						<CardContent className="p-4">
							<p className="font-semibold text-sm">{f.title}</p>
							<p className="mt-1 text-muted-foreground text-sm">{f.desc}</p>
						</CardContent>
					</Card>
				))}
			</div>

			<h2 id="safe-to-spend" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Safe-to-Spend
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				The dashboard guide line shows your ideal daily pace based on your budget. The
				&quot;safe-to-spend&quot; number tells you how much you can spend per remaining day
				this month and still hit your target. It updates live as you log transactions.
			</p>

			<h2 id="budget-playground" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Budget Playground
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				The budget playground is a sandbox for experimenting with different allocations before
				committing them. Adjust category limits, see how the partition bar shifts, and test
				different budget distributions. Nothing saves until you explicitly apply the changes.
			</p>
			<Callout variant="info" title="Exclude from analytics">
				Some expenses (one-off purchases, security deposits) can be excluded from analytics.
				Excluded transactions won&apos;t count toward budget limits or dashboard totals but
				remain in your transaction history.
			</Callout>

			<h2 id="tips" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Tips
			</h2>
			<Callout variant="tip" title="Peg fixed costs">
				Use &quot;Peg to actual&quot; for rent, insurance, and subscriptions. This way your
				safe-to-spend calculation only reflects categories you can actually control.
			</Callout>
			<Callout variant="tip" title="Budget history">
				Navigate to past months to compare your budget performance over time. Each month stores
				its own snapshot, so changing a current budget never alters historical data.
			</Callout>
			<Callout variant="info" title="Multi-currency budgets">
				Budget limits are set in your home currency. Expenses in other currencies are
				converted automatically using the rate at the time of the transaction.
			</Callout>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
