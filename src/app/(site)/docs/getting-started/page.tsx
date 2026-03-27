import type { Metadata } from "next"
import Link from "next/link"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { Callout } from "../_components/callout"
import { DocsNav } from "../_components/docs-nav"
import { getAdjacentDocs } from "../docs-config"

export const metadata: Metadata = {
	title: "Introduction",
	description: "What is Retrospend and how to get started.",
}

const slug = "getting-started"

export default function IntroductionPage() {
	const { prev, next } = getAdjacentDocs(slug)

	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">
					Getting Started
				</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">Introduction</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					Retrospend is a self-hostable personal finance tracker for expenses,
					budgets, and wealth, built for people who want full control over
					their financial data.
				</p>
			</div>

			<h2 id="what-is-retrospend" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				What is Retrospend?
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Retrospend is a full-stack web app you can run on your own server or
				use via the hosted instance at{" "}
				<a
					href="https://retrospend.app"
					className="text-primary underline underline-offset-4"
					target="_blank"
					rel="noopener noreferrer"
				>
					retrospend.app
				</a>
				. It&apos;s open source (GPLv3), with no telemetry, no ads, and no
				vendor lock-in.
			</p>

			<h2 id="key-features" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Key Features
			</h2>
			<div className="grid gap-3 sm:grid-cols-2">
				{[
					{
						title: "Expense Tracking",
						desc: "Log and categorize transactions with multi-currency support.",
					},
					{
						title: "Budget Pacing",
						desc: "Daily safe-to-spend calculated in real time against your budget.",
					},
					{
						title: "Wealth Tracking",
						desc: "Track assets, liabilities, net worth, and financial runway.",
					},
					{
						title: "Bank Import",
						desc: "Import CSV, PDF, or XLSX statements. AI handles categorization.",
					},
					{
						title: "Shared Expenses",
						desc: "Split bills with others, track who owes what, settle up.",
					},
					{
						title: "Multi-Currency",
						desc: "Fiat and crypto with parallel market rate support.",
					},
					{
						title: "Privacy Mode",
						desc: "One toggle hides all amounts on screen.",
					},
					{
						title: "Recurring Detection",
						desc: "Subscriptions and fixed costs tracked automatically.",
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

			<h2 id="two-ways-to-use" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Two Ways to Use Retrospend
			</h2>
			<div className="grid gap-4 sm:grid-cols-2">
				<Card className="border-primary/20 bg-primary/5">
					<CardContent className="p-5">
						<p className="font-semibold">Hosted Instance</p>
						<p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">
							Sign up at retrospend.app. Free, no setup required, runs in
							seconds. Best if you just want to start tracking.
						</p>
						<Button asChild size="sm" className="mt-4">
							<Link href="/signup">Get Started Free →</Link>
						</Button>
					</CardContent>
				</Card>
				<Card className="border-border bg-card">
					<CardContent className="p-5">
						<p className="font-semibold">Self-Hosted</p>
						<p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">
							Run on your own server with Docker. Full control over your data,
							bring your own domain, customize as needed.
						</p>
						<Button asChild size="sm" variant="outline" className="mt-4">
							<Link href="/docs/self-hosting">Deployment Guide →</Link>
						</Button>
					</CardContent>
				</Card>
			</div>

			<Callout variant="tip" title="Just want to try it?">
				The fastest path is the{" "}
				<Link href="/docs/getting-started/quick-start" className="underline">
					hosted quick start
				</Link>
				. No Docker, no config, no server needed.
			</Callout>

			<h2 id="open-source" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Open Source
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Retrospend is licensed under the{" "}
				<a
					href="https://www.gnu.org/licenses/gpl-3.0.html"
					className="text-primary underline underline-offset-4"
					target="_blank"
					rel="noopener noreferrer"
				>
					GNU GPLv3
				</a>
				. The source code is available on{" "}
				<a
					href="https://github.com/syntheit/retrospend"
					className="text-primary underline underline-offset-4"
					target="_blank"
					rel="noopener noreferrer"
				>
					GitHub
				</a>
				. Contributions, bug reports, and feature requests are welcome.
			</p>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
