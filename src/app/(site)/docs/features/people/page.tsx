import type { Metadata } from "next"
import { Badge } from "~/components/ui/badge"
import { Callout } from "../../_components/callout"
import { DocsNav } from "../../_components/docs-nav"
import { getAdjacentDocs } from "../../docs-config"

export const metadata: Metadata = {
	title: "People & Settlements",
	description: "Manage contacts, track per-person balances, and settle debts.",
}

const slug = "features/people"

export default function PeoplePage() {
	const { prev, next } = getAdjacentDocs(slug)
	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">Features</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">People &amp; Settlements</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					The People section tracks everyone you split expenses with and what you owe each other.
					Balances update automatically as you add shared expenses and record settlements.
				</p>
			</div>

			<h2 id="contacts" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Contacts
			</h2>
			<p className="mb-3 text-muted-foreground leading-relaxed">
				Two types of contacts:
			</p>
			<ul className="mb-4 list-disc space-y-1.5 pl-6 text-muted-foreground text-sm leading-relaxed">
				<li><strong>Retrospend users</strong>: Real accounts on the platform. They receive notifications and can verify or dispute shared expenses.</li>
				<li><strong>Shadow contacts</strong>: People without an account. You track debts on their behalf. If they sign up later, their balance and history carry over automatically.</li>
			</ul>

			<h2 id="balances" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Balances
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Balances are tracked per person across all currencies. The summary shows a net balance
				in your home currency, with a breakdown by currency underneath. Balances include all
				shared expenses and settlements, whether from a project or a standalone split.
			</p>

			<h2 id="verification-queue" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Verification Queue
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				When someone shares an expense with you, it appears in your verification queue. You can
				accept, reject, or bulk-accept pending shares. Unresponded shares auto-accept after 7 days.
			</p>

			<h2 id="settling-up" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Settling Up
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				The settlement flow: pick a person, enter the amount and currency, choose a payment method,
				add an optional note, confirm. The settlement is recorded and the balance updates immediately.
			</p>

			<h3 id="payment-method-matching" className="mt-8 mb-3 font-semibold text-lg scroll-mt-20">
				Payment Method Matching
			</h3>
			<p className="text-muted-foreground leading-relaxed">
				When settling up, Retrospend shows payment methods that both you and the other person have
				in common. If supported, it generates a deep link to the payment app (Venmo, PayPal, etc.)
				with the amount pre-filled.
			</p>

			<h2 id="person-detail" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Person Detail
			</h2>
			<p className="mb-3 text-muted-foreground leading-relaxed">
				Each person has a detail page showing:
			</p>
			<ul className="mb-4 list-disc space-y-1.5 pl-6 text-muted-foreground text-sm leading-relaxed">
				<li>Transaction timeline: all shared expenses and settlements in chronological order.</li>
				<li>Balance breakdown by currency.</li>
				<li>Links to related projects.</li>
			</ul>

			<Callout variant="info" title="Shadow contacts carry over">
				When a shadow contact creates a Retrospend account with the same email, their existing
				balance and transaction history are automatically linked to the new account.
			</Callout>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
