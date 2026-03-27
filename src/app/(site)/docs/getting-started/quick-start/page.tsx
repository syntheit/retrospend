import type { Metadata } from "next"
import Link from "next/link"
import { Badge } from "~/components/ui/badge"
import { Callout } from "../../_components/callout"
import { DocsNav } from "../../_components/docs-nav"
import { getAdjacentDocs } from "../../docs-config"

export const metadata: Metadata = {
	title: "Hosted Quick Start",
	description: "Sign up for Retrospend and start tracking in minutes.",
}

const slug = "getting-started/quick-start"

export default function QuickStartPage() {
	const { prev, next } = getAdjacentDocs(slug)

	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">
					Getting Started
				</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">
					Hosted Quick Start
				</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					Get up and running on the hosted instance in under two minutes. No
					server, no Docker, no configuration.
				</p>
			</div>

			<h2 id="sign-up" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				1. Create an account
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Go to{" "}
				<Link href="/signup" className="text-primary underline underline-offset-4">
					retrospend.app/signup
				</Link>{" "}
				and create a free account. No credit card required.
			</p>

			<h2 id="add-first-expense" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				2. Add your first expense
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Once logged in, click the{" "}
				<strong className="text-foreground">+ Add Expense</strong> button in the
				top bar. Enter the amount, category, and date. Your
				dashboard will update immediately.
			</p>

			<h2 id="set-up-a-budget" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				3. Set up a budget
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Navigate to{" "}
				<strong className="text-foreground">Budget</strong> in the sidebar.
				Set a monthly limit per category or a global monthly budget.
				Retrospend will calculate your daily safe-to-spend automatically.
			</p>

			<h2 id="import-transactions" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				4. Import from your bank (optional)
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Go to <strong className="text-foreground">Settings → Import</strong> and
				upload a CSV, PDF, or XLSX export from your bank. The AI import pipeline
				will categorize transactions automatically. You can review and edit
				before confirming.
			</p>

			<Callout variant="info" title="Supported formats">
				Most banks export CSV or PDF statements from their online portal.
				Retrospend supports standard CSV layouts, PDF text-based statements,
				and XLSX files.
			</Callout>

			<h2 id="configure-settings" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				5. Configure your preferences
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Head to <strong className="text-foreground">Settings</strong> to:
			</p>
			<ul className="mt-3 space-y-2 text-muted-foreground text-sm leading-relaxed">
				<li>• Set your preferred currency and locale</li>
				<li>• Configure your fiscal month start date</li>
				<li>• Enable two-factor authentication</li>
				<li>• Set up notification preferences</li>
				<li>• Upload a profile photo</li>
			</ul>

			<Callout variant="tip" title="Want more control?">
				If you&apos;d prefer to self-host Retrospend on your own server, see the{" "}
				<Link
					href="/docs/self-hosting"
					className="underline"
				>
					Docker Deployment guide
				</Link>
				.
			</Callout>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
