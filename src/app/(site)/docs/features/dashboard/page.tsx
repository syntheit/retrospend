import type { Metadata } from "next"
import { Badge } from "~/components/ui/badge"
import { Card, CardContent } from "~/components/ui/card"
import { Callout } from "../../_components/callout"
import { DashboardDemoEmbed } from "../../_components/demo-embeds"
import { DocsNav } from "../../_components/docs-nav"
import { getAdjacentDocs } from "../../docs-config"

export const metadata: Metadata = {
	title: "Dashboard",
	description: "Your monthly spending overview at a glance.",
}

const slug = "features/dashboard"

export default function DashboardPage() {
	const { prev, next } = getAdjacentDocs(slug)
	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">Features</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">Dashboard</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					Your monthly spending overview: totals, trends, categories, and recent transactions in one view.
				</p>
			</div>

			<DashboardDemoEmbed />

			<h2 id="what-you-see" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				What You See
			</h2>
			<p className="mb-4 text-muted-foreground leading-relaxed">
				The dashboard is your home screen. Every element updates in real time as you add or edit expenses.
			</p>
			<div className="grid gap-3 sm:grid-cols-2">
				{[
					{ title: "Stat Cards", desc: "Total spent, daily average, projected month-end spend, and change vs. last month." },
					{ title: "Budget Pacing", desc: "A trend chart showing your cumulative spend against a daily guide line derived from your budget." },
					{ title: "Category Donut", desc: "Visual breakdown of where your money goes. Click a slice to highlight it; click the legend to hide categories." },
					{ title: "Recent Expenses", desc: "The last 5 transactions with amount, category badge, and date. Click any to edit." },
				].map((card) => (
					<Card key={card.title} className="border-border bg-card">
						<CardContent className="p-4">
							<p className="font-semibold text-sm">{card.title}</p>
							<p className="mt-1 text-muted-foreground text-sm">{card.desc}</p>
						</CardContent>
					</Card>
				))}
			</div>

			<h2 id="spend-composition" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Spend Composition
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Below the main dashboard cards, the spend composition table shows category-level trends
				across months. Each row is a category with columns for the current month, previous months,
				and the percentage change. Useful for spotting categories where spending is creeping up
				or dropping off compared to your recent history.
			</p>

			<h2 id="navigating-months" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Navigating Months
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Use the month stepper at the top to browse previous months. The dashboard fully recalculates
				for whichever month is selected: stat cards, chart, donut, and recent expenses all reflect
				the chosen period. You cannot navigate past the current month.
			</p>

			<h3 id="fiscal-month" className="mt-8 mb-3 font-semibold text-lg scroll-mt-20">
				Custom Fiscal Month
			</h3>
			<p className="text-muted-foreground leading-relaxed">
				If your budget cycle starts on a day other than the 1st (e.g. payday on the 15th), you can set
				a custom fiscal month start in <strong>Settings → App Preferences</strong>. All dashboard
				calculations will shift to use your chosen start date.
			</p>

			<h2 id="tips" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Tips
			</h2>
			<Callout variant="tip" title="Donut interactions">
				Click any slice in the donut chart to isolate that category. Click a legend label to
				toggle categories on and off, useful for seeing spend without fixed costs like rent.
			</Callout>
			<Callout variant="tip" title="Home currency conversion">
				If you log expenses in multiple currencies, all dashboard totals are converted to your
				home currency automatically using the exchange rate at the time of each transaction.
			</Callout>
			<Callout variant="info" title="Privacy mode">
				Toggle privacy mode from the sidebar to instantly blur all amounts on screen. The
				dashboard layout stays intact; only numbers are hidden.
			</Callout>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
