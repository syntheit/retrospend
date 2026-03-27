import type { Metadata } from "next"
import { Badge } from "~/components/ui/badge"
import { Card, CardContent } from "~/components/ui/card"
import { Callout } from "../../_components/callout"
import { WealthDemoEmbed } from "../../_components/demo-embeds"
import { DocsNav } from "../../_components/docs-nav"
import { getAdjacentDocs } from "../../docs-config"

export const metadata: Metadata = {
	title: "Wealth Tracking",
	description: "Track assets, liabilities, net worth, and financial runway.",
}

const slug = "features/wealth"

export default function WealthPage() {
	const { prev, next } = getAdjacentDocs(slug)
	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">Features</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">Wealth Tracking</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					Track your full financial picture: assets, liabilities, net worth over time, and financial runway.
				</p>
			</div>

			<WealthDemoEmbed />

			<h2 id="what-you-track" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				What You Track
			</h2>
			<div className="grid gap-3 sm:grid-cols-2">
				{[
					{ title: "Assets", desc: "Bank accounts, investments, crypto wallets, property, and anything else with positive value. Each entry has a name, balance, currency, and type." },
					{ title: "Liabilities", desc: "Loans, credit card balances, mortgages. Tracked separately and subtracted from assets to calculate net worth." },
					{ title: "Net Worth History", desc: "A 365-day chart showing how your net worth evolves. Automatic daily snapshots capture every change." },
					{ title: "Allocation Chart", desc: "A donut breakdown of asset allocation across types: stocks, savings, crypto, property, and more." },
				].map((card) => (
					<Card key={card.title} className="border-border bg-card">
						<CardContent className="p-4">
							<p className="font-semibold text-sm">{card.title}</p>
							<p className="mt-1 text-muted-foreground text-sm">{card.desc}</p>
						</CardContent>
					</Card>
				))}
			</div>

			<h2 id="adding-assets" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Adding Assets
			</h2>
			<p className="mb-3 text-muted-foreground leading-relaxed">
				Click <strong>Add Asset</strong> to open the asset form. You&apos;ll provide:
			</p>
			<ul className="mb-4 list-disc space-y-1.5 pl-6 text-muted-foreground text-sm leading-relaxed">
				<li><strong>Name</strong>: a label like &quot;Chase Checking&quot; or &quot;Coinbase BTC&quot;</li>
				<li><strong>Type</strong>: stocks, savings, crypto, property, or other</li>
				<li><strong>Currency</strong>: the native currency of the asset (supports fiat and crypto)</li>
				<li><strong>Balance</strong>: current value in the asset&apos;s native currency</li>
				<li><strong>Liquid?</strong>: toggle to mark as liquid (used for runway calculation)</li>
				<li><strong>Interest/APR</strong>: optional annual rate for savings or debt accounts</li>
			</ul>
			<p className="text-muted-foreground leading-relaxed">
				Non-USD assets are automatically converted to your home currency using live exchange rates.
				You can update balances at any time; the history chart captures each change.
			</p>

			<h2 id="financial-runway" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Financial Runway
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Retrospend calculates your financial runway as: <strong>liquid assets ÷ average monthly spend</strong>.
				This tells you how many months you could sustain your current lifestyle without income. The runway
				updates automatically as your liquid asset balances and spending patterns change.
			</p>

			<h2 id="tips" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Tips
			</h2>
			<Callout variant="tip" title="Liquid vs illiquid">
				Mark assets as liquid if you could access the money within a few days (bank accounts,
				money market funds). Property and retirement accounts are typically illiquid.
				Only liquid assets count toward your financial runway.
			</Callout>
			<Callout variant="tip" title="Automatic snapshots">
				Retrospend takes a daily snapshot of your net worth. You don&apos;t need to do anything;
				just keep your balances up to date and the history chart fills in automatically.
			</Callout>
			<Callout variant="info" title="Multi-currency assets">
				Assets in foreign currencies update their USD equivalent whenever you edit them or
				when exchange rates change. The allocation chart always shows percentages in your
				home currency.
			</Callout>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
