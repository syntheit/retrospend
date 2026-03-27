import type { Metadata } from "next"
import { Badge } from "~/components/ui/badge"
import { Card, CardContent } from "~/components/ui/card"
import { Callout } from "../../_components/callout"
import { DocsNav } from "../../_components/docs-nav"
import { getAdjacentDocs } from "../../docs-config"

export const metadata: Metadata = {
	title: "Recurring Expenses",
	description: "Automate subscriptions, bills, and repeating expenses.",
}

const slug = "features/recurring"

export default function RecurringExpensesPage() {
	const { prev, next } = getAdjacentDocs(slug)
	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">Features</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">Recurring Expenses</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					Recurring expenses automate the transactions you log every week, month, or year.
					Set up a template once and Retrospend generates the expense for you on schedule.
				</p>
			</div>

			<h2 id="how-it-works" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				How It Works
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				You create a recurring template with an amount, currency, category, frequency, and start date.
				The sidecar service checks every 15 minutes for templates that are due. When one is due, it
				generates an expense and advances the <code>nextDueDate</code> to the next occurrence.
			</p>

			<h2 id="frequencies" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Frequencies
			</h2>
			<div className="grid gap-3 sm:grid-cols-3">
				{[
					{ title: "Weekly", desc: "Repeats every 7 days from the start date. Good for weekly groceries or gym sessions." },
					{ title: "Monthly", desc: "Repeats on the same day each month. The go-to for subscriptions and bills." },
					{ title: "Yearly", desc: "Repeats once a year. Use it for annual renewals, insurance premiums, or memberships." },
				].map((card) => (
					<Card key={card.title} className="border-border bg-card">
						<CardContent className="p-4">
							<p className="font-semibold text-sm">{card.title}</p>
							<p className="mt-1 text-muted-foreground text-sm">{card.desc}</p>
						</CardContent>
					</Card>
				))}
			</div>

			<h2 id="creating-a-template" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Creating a Template
			</h2>
			<p className="mb-3 text-muted-foreground leading-relaxed">
				Required fields:
			</p>
			<ul className="mb-4 list-disc space-y-1.5 pl-6 text-muted-foreground text-sm leading-relaxed">
				<li><strong>Name</strong>: what the expense is (e.g. &quot;Netflix&quot;, &quot;Rent&quot;).</li>
				<li><strong>Amount</strong>: the recurring cost.</li>
				<li><strong>Currency</strong>: which currency the expense is in.</li>
				<li><strong>Category</strong>: for budget and analytics grouping.</li>
				<li><strong>Frequency</strong>: weekly, monthly, or yearly.</li>
				<li><strong>Start date</strong>: when the first expense should be generated.</li>
			</ul>
			<p className="mb-3 text-muted-foreground leading-relaxed">
				Optional fields:
			</p>
			<ul className="mb-4 list-disc space-y-1.5 pl-6 text-muted-foreground text-sm leading-relaxed">
				<li><strong>Website URL</strong>: link to the service or provider.</li>
				<li><strong>Auto-pay toggle</strong>: mark whether this is automatically charged.</li>
				<li><strong>Notes</strong>: any extra context you want to remember.</li>
			</ul>
			<Callout variant="tip" title="Start date tip">
				Set the start date to when the next payment is due, not when the subscription started.
			</Callout>

			<h2 id="views" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Views
			</h2>
			<p className="mb-3 text-muted-foreground leading-relaxed">
				Two views are available on the recurring page:
			</p>

			<h3 id="calendar-view" className="mt-8 mb-3 font-semibold text-lg scroll-mt-20">
				Calendar View
			</h3>
			<p className="text-muted-foreground leading-relaxed">
				A month grid showing which days have recurring expenses due. Each entry is color-coded
				by category so you can see at a glance what&apos;s coming up.
			</p>

			<h3 id="list-view" className="mt-8 mb-3 font-semibold text-lg scroll-mt-20">
				List View
			</h3>
			<p className="text-muted-foreground leading-relaxed">
				A sortable table of all templates. Shows name, amount, frequency, next due date, and
				status. Use this when you need to quickly scan or edit your recurring expenses.
			</p>

			<h2 id="stats" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Stats
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				The recurring page shows two summary stats: total monthly cost of all active templates,
				and projected annual cost. These update automatically as you add, pause, or remove templates.
			</p>

			<h2 id="pausing" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Pausing
			</h2>
			<Callout variant="info" title="Pausing a template">
				Toggle a template to inactive to stop generating expenses without deleting the template.
				Reactivate it later and it picks up from where it left off.
			</Callout>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
