import type { Metadata } from "next";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { Callout } from "../../_components/callout";
import { BudgetDemoEmbed } from "../../_components/demo-embeds";
import { DocsNav } from "../../_components/docs-nav";
import { getAdjacentDocs } from "../../docs-config";

export const metadata: Metadata = {
	title: "Budgets",
	description: "Set spending limits and track real-time budget pacing.",
};

const slug = "features/budgets";

export default function BudgetsPage() {
	const { prev, next } = getAdjacentDocs(slug);
	return (
		<article>
			<div className="mb-8">
				<Badge className="mb-3" variant="secondary">
					Features
				</Badge>
				<h1 className="mb-3 text-3xl font-bold tracking-tight">
					Budget Tracking
				</h1>
				<p className="text-muted-foreground text-lg leading-relaxed">
					Set per-category spending limits and see exactly where you stand at
					any point in the month.
				</p>
			</div>

			<BudgetDemoEmbed />

			<h2
				className="mt-10 mb-4 scroll-mt-20 text-xl font-bold tracking-tight"
				id="how-budgets-work"
			>
				How Budgets Work
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Each category in your budget has a monthly spending limit. As you log
				expenses, Retrospend tracks actual spend against the limit in real time.
				The partition bar at the top shows how your total budget is allocated
				across categories, and each category row includes a bullet chart showing
				spend vs. limit.
			</p>

			<h2
				className="mt-10 mb-4 scroll-mt-20 text-xl font-bold tracking-tight"
				id="variable-vs-fixed"
			>
				Variable vs Fixed Categories
			</h2>
			<p className="text-muted-foreground mb-4 leading-relaxed">
				Budget categories are split into two groups:
			</p>
			<div className="grid gap-3 sm:grid-cols-2">
				<Card className="border-border bg-card">
					<CardContent className="p-4">
						<p className="text-sm font-semibold">Variable / Managed</p>
						<p className="text-muted-foreground mt-1 text-sm">
							Categories where you actively control spending: groceries, dining,
							entertainment. You set a target limit and Retrospend calculates a
							daily safe-to-spend pace.
						</p>
					</CardContent>
				</Card>
				<Card className="border-border bg-card">
					<CardContent className="p-4">
						<p className="text-sm font-semibold">Fixed / Pegged to Actual</p>
						<p className="text-muted-foreground mt-1 text-sm">
							Categories with predictable costs: rent, subscriptions, insurance.
							Toggle &quot;Peg to actual&quot; and the budget automatically
							matches what you spend, keeping the focus on variable categories.
						</p>
					</CardContent>
				</Card>
			</div>

			<h2
				className="mt-10 mb-4 scroll-mt-20 text-xl font-bold tracking-tight"
				id="key-features"
			>
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
					<Card className="border-border bg-card" key={f.title}>
						<CardContent className="p-4">
							<p className="text-sm font-semibold">{f.title}</p>
							<p className="text-muted-foreground mt-1 text-sm">{f.desc}</p>
						</CardContent>
					</Card>
				))}
			</div>

			<h2
				className="mt-10 mb-4 scroll-mt-20 text-xl font-bold tracking-tight"
				id="safe-to-spend"
			>
				Safe-to-Spend
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				The dashboard guide line shows your ideal daily pace based on your
				budget. The &quot;safe-to-spend&quot; number tells you how much you can
				spend per remaining day this month and still hit your target. It updates
				live as you log transactions.
			</p>

			<h2
				className="mt-10 mb-4 scroll-mt-20 text-xl font-bold tracking-tight"
				id="plan"
			>
				Plan next month and What if
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Plan next month is a draft of what each envelope gets next month, with
				the money you expect to come in. Saving it changes nothing this month:
				when next month&apos;s money arrives, Use my plan starts from it. What
				if lets you try a purchase or a move first and shows which envelopes
				would go short. Only the moves you apply are written.
			</p>
			<Callout title="Exclude from analytics" variant="info">
				Some expenses (one-off purchases, security deposits) can be excluded
				from analytics. Excluded transactions won&apos;t count toward budget
				limits or dashboard totals but remain in your transaction history.
			</Callout>

			<h2
				className="mt-10 mb-4 scroll-mt-20 text-xl font-bold tracking-tight"
				id="tips"
			>
				Tips
			</h2>
			<Callout title="Peg fixed costs" variant="tip">
				Use &quot;Peg to actual&quot; for rent, insurance, and subscriptions.
				This way your safe-to-spend calculation only reflects categories you can
				actually control.
			</Callout>
			<Callout title="Budget history" variant="tip">
				Navigate to past months to compare your budget performance over time.
				Each month stores its own snapshot, so changing a current budget never
				alters historical data.
			</Callout>
			<Callout title="Multi-currency budgets" variant="info">
				Budget limits are set in your home currency. Expenses in other
				currencies are converted automatically using the rate at the time of the
				transaction.
			</Callout>

			<DocsNav next={next} prev={prev} />
		</article>
	);
}
