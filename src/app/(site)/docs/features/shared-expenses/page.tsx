import type { Metadata } from "next"
import { Badge } from "~/components/ui/badge"
import { Card, CardContent } from "~/components/ui/card"
import { Callout } from "../../_components/callout"
import { SplitCalculatorDemoEmbed } from "../../_components/demo-embeds"
import { DocsNav } from "../../_components/docs-nav"
import { getAdjacentDocs } from "../../docs-config"

export const metadata: Metadata = {
	title: "Shared Expenses",
	description: "Split bills, track debts, and settle up with friends.",
}

const slug = "features/shared-expenses"

export default function SharedExpensesPage() {
	const { prev, next } = getAdjacentDocs(slug)
	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">Features</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">Shared Expenses</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					Split bills with others, track who owes what, and settle debts, all within your expense tracker.
				</p>
			</div>

			<SplitCalculatorDemoEmbed />

			<h2 id="how-splitting-works" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				How Splitting Works
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Retrospend uses a person-centric debt model. When you pay for something shared, you record
				the full expense and specify how it&apos;s split among participants. Each person&apos;s
				share becomes a debt they owe you, and Retrospend tracks the running balance.
			</p>

			<h2 id="split-modes" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Split Modes
			</h2>
			<p className="mb-4 text-muted-foreground leading-relaxed">
				Four ways to divide an expense:
			</p>
			<div className="grid gap-3 sm:grid-cols-2">
				{[
					{ title: "Equal", desc: "Everyone pays the same amount. The total is divided evenly among all participants." },
					{ title: "Exact Amounts", desc: "Specify the exact dollar amount each person owes. Useful when items have different prices." },
					{ title: "Percentage", desc: "Assign a percentage to each person. Percentages must total 100%." },
					{ title: "Shares", desc: "Assign share units (e.g. 2, 1, 1). Useful when one person should pay double." },
				].map((card) => (
					<Card key={card.title} className="border-border bg-card">
						<CardContent className="p-4">
							<p className="font-semibold text-sm">{card.title}</p>
							<p className="mt-1 text-muted-foreground text-sm">{card.desc}</p>
						</CardContent>
					</Card>
				))}
			</div>

			<h2 id="adding-people" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Adding People
			</h2>
			<p className="mb-3 text-muted-foreground leading-relaxed">
				You can split expenses with two types of people:
			</p>
			<ul className="mb-4 list-disc space-y-1.5 pl-6 text-muted-foreground text-sm leading-relaxed">
				<li><strong>Retrospend users</strong>: search by name or email. They get in-app notifications and can verify/dispute their share.</li>
				<li><strong>Shadow contacts</strong>: people without a Retrospend account. You track the debt on their behalf; settle up externally.</li>
			</ul>

			<h2 id="verification" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Verification
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				When you share an expense with another Retrospend user, they receive a notification
				and can either <strong>verify</strong> (accept) or <strong>dispute</strong> the amount.
				Disputed expenses are flagged so you can discuss and adjust. This prevents one-sided
				debt tracking and keeps both parties in sync.
			</p>

			<h2 id="settlement" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Settlement
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				When it&apos;s time to settle up, Retrospend shows the net balance between you and each person.
				Record a settlement to zero out the balance. Settlements support payment links (Venmo, PayPal, etc.)
				so you can share a pay-me link directly from the app.
			</p>

			<h2 id="guest-participation" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Guest Participation
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				People without a Retrospend account can participate in shared expenses through magic links.
				Send them a link and they get a guest session with just their name and email. No signup,
				no password. Guests can view their shares, accept or dispute amounts, and see project
				activity. If they decide to create a full account later, their guest history carries over.
			</p>

			<h2 id="auto-verification" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Auto-Verification
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Shared expenses that go unresponded for 7 days are automatically accepted. This prevents
				stale pending shares from blocking settlements. The original sharer gets a notification
				when auto-acceptance happens.
			</p>

			<h2 id="with-or-without-projects" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				With or Without Projects
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				You can split expenses two ways: quick splits (no project needed) or project-based splits.
				Quick splits are fastest for one-off bills. Projects are better when you have many shared
				expenses with the same group over time. Both types feed into the same per-person balance,
				so it doesn&apos;t matter which approach you use for a given expense.
			</p>

			<h2 id="tips" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Tips
			</h2>
			<Callout variant="tip" title="&quot;They owe full amount&quot;">
				When someone else paid for the whole thing but you only owe your share, use the
				&quot;they owe full amount&quot; toggle. This flips the direction so the expense
				shows as someone else paying for you.
			</Callout>
			<Callout variant="tip" title="Per-person settlement">
				You don&apos;t have to settle all debts at once. Retrospend tracks balances
				per person, so you can settle with one friend while keeping a running tab with another.
			</Callout>
			<Callout variant="info" title="Projects">
				Group shared expenses into projects (e.g. &quot;Ski Trip 2026&quot;) to keep things
				organized. Each project has its own balance sheet and settlement summary.
			</Callout>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
