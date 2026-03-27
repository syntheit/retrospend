import type { Metadata } from "next"
import { Badge } from "~/components/ui/badge"
import { Card, CardContent } from "~/components/ui/card"
import { Callout } from "../../_components/callout"
import { CurrencyConverterDemoEmbed } from "../../_components/demo-embeds"
import { DocsNav } from "../../_components/docs-nav"
import { getAdjacentDocs } from "../../docs-config"

export const metadata: Metadata = {
	title: "Multi-Currency",
	description: "Log expenses in any currency with automatic conversion and parallel market rates.",
}

const slug = "features/multi-currency"

export default function MultiCurrencyPage() {
	const { prev, next } = getAdjacentDocs(slug)
	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">Features</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">Multi-Currency</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					Log expenses in any fiat or cryptocurrency. Retrospend converts everything to your
					home currency automatically.
				</p>
			</div>

			<CurrencyConverterDemoEmbed />

			<h2 id="how-it-works" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				How It Works
			</h2>
			<p className="mb-3 text-muted-foreground leading-relaxed">
				Every expense stores both the original amount in its native currency and the
				converted amount in your home currency. The conversion happens at the exchange
				rate active when you log the expense.
			</p>
			<ul className="mb-4 list-disc space-y-1.5 pl-6 text-muted-foreground text-sm leading-relaxed">
				<li><strong>Home currency</strong>: set once in Settings. All totals, budgets, and charts use this currency.</li>
				<li><strong>Auto rates</strong>: Retrospend fetches exchange rates automatically. The rate is locked at the time of the transaction.</li>
				<li><strong>Manual override</strong>: if the auto rate doesn&apos;t match your actual exchange, you can type a custom rate.</li>
			</ul>

			<h2 id="parallel-market-rates" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Parallel Market Rates
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Some countries have significant gaps between official and market exchange rates
				(e.g. Argentina&apos;s &quot;blue dollar&quot;). Retrospend supports custom exchange
				rates per transaction, so you can log the rate you actually paid. This is especially
				useful for travelers and expats who exchange money at parallel market rates.
			</p>

			<h2 id="cryptocurrency" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Cryptocurrency
			</h2>
			<p className="mb-3 text-muted-foreground leading-relaxed">
				Retrospend supports BTC, ETH, and other cryptocurrencies as both expense currencies
				and wealth asset currencies. Crypto rates work slightly differently:
			</p>
			<div className="grid gap-3 sm:grid-cols-2">
				<Card className="border-border bg-card">
					<CardContent className="p-4">
						<p className="font-semibold text-sm">Fiat Rates</p>
						<p className="mt-1 text-muted-foreground text-sm">
							Stored as units per USD (e.g. 1 USD = 149.5 JPY). To convert JPY to USD, divide by the rate.
						</p>
					</CardContent>
				</Card>
				<Card className="border-border bg-card">
					<CardContent className="p-4">
						<p className="font-semibold text-sm">Crypto Rates</p>
						<p className="mt-1 text-muted-foreground text-sm">
							Stored as USD per unit (e.g. 1 BTC = $97,500). To convert BTC to USD, multiply by the rate.
						</p>
					</CardContent>
				</Card>
			</div>
			<p className="mt-3 text-muted-foreground leading-relaxed">
				This distinction is handled automatically; you just enter the amount and Retrospend
				does the math.
			</p>

			<h2 id="currencies-page" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Currencies Page
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				The dedicated currencies page shows all exchange rates at a glance. You can mark currencies
				as favorites and drag-and-drop to reorder them. Favorites appear at the top of every
				currency picker throughout the app. The page also includes a calculator widget for quick
				conversions between any two currencies.
			</p>

			<h3 id="rate-sync" className="mt-8 mb-3 font-semibold text-lg scroll-mt-20">
				Rate Sync
			</h3>
			<p className="text-muted-foreground leading-relaxed">
				Exchange rates are synced daily at 09:05 UTC from public market data APIs. The sidecar
				service handles the sync automatically. Historical rates are preserved, so past
				transactions always use the rate that was active when they were logged.
			</p>

			<h2 id="tips" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Tips
			</h2>
			<Callout variant="tip" title="Currency favorites">
				Add frequently-used currencies to your favorites in Settings. They appear first
				in the currency picker, saving you from scrolling through 150+ currencies every time.
			</Callout>
			<Callout variant="tip" title="Original amounts preserved">
				Even after conversion, the original amount and currency are always preserved.
				You can see both the native amount and the home-currency equivalent on every
				transaction.
			</Callout>
			<Callout variant="info" title="Rate sources">
				Retrospend fetches exchange rates from public market data APIs. Rates are
				updated regularly but may differ slightly from your bank&apos;s rate. Use
				the manual override if precision matters for a specific transaction.
			</Callout>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
