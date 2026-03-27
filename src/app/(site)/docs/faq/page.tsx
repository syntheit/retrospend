import type { Metadata } from "next"
import Link from "next/link"
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "~/components/ui/accordion"
import { Badge } from "~/components/ui/badge"
import { DocsNav } from "../_components/docs-nav"
import { getAdjacentDocs } from "../docs-config"

export const metadata: Metadata = {
	title: "FAQ",
	description: "Frequently asked questions about Retrospend.",
}

const slug = "faq"

const FAQS: { q: string; a: React.ReactNode }[] = [
	{
		q: "Is Retrospend really free?",
		a: "Yes. The hosted instance at retrospend.app is free to use with no credit card required. The source code is also free to self-host under the GPLv3 license.",
	},
	{
		q: "What data does Retrospend collect?",
		a: "When using the hosted instance: your account info and the financial data you enter. We don't use analytics, tracking cookies, or ad pixels. When self-hosting, all data stays on your server.",
	},
	{
		q: "Can I export my data?",
		a: "Yes. Go to Settings → Export to download your expenses as CSV. You can also use the database backup approach to export everything.",
	},
	{
		q: "Does the bank import feature work without an AI key?",
		a: "No. The import pipeline requires either a local Ollama instance or an OpenRouter API key. You can still import data manually by entering transactions, or by using a correctly formatted CSV that Retrospend can parse directly.",
	},
	{
		q: "What currencies are supported?",
		a: "Retrospend supports all major fiat currencies plus a wide range of cryptocurrencies. Parallel market exchange rates (e.g., Argentina's blue dollar) are also supported; you pick which rate applies.",
	},
	{
		q: "Can multiple people use the same instance?",
		a: "Yes. Each user has their own account and isolated data. Shared expenses let users split bills across accounts. An admin panel is available to manage users.",
	},
	{
		q: "How do I self-host Retrospend?",
		a: (
			<>
				The recommended method is Docker Compose. See the{" "}
				<Link
					href="/docs/self-hosting"
					className="text-primary underline underline-offset-4"
				>
					Docker Deployment guide
				</Link>{" "}
				for full instructions.
			</>
		),
	},
	{
		q: "Do I need a GPU for the local AI import?",
		a: "No, but it helps. Ollama can run on CPU, but processing will be slower. A modern CPU can still process bank statements in reasonable time for personal use. GPU acceleration is supported for NVIDIA cards via the docker-compose configuration.",
	},
	{
		q: "How do I update my self-hosted instance?",
		a: (
			<>
				Run <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">docker compose pull && docker compose up -d</code>. Migrations run automatically on startup. See the{" "}
				<Link
					href="/docs/self-hosting/updates"
					className="text-primary underline underline-offset-4"
				>
					Updating guide
				</Link>{" "}
				for details.
			</>
		),
	},
	{
		q: "Is HTTPS required?",
		a: "Not strictly, but strongly recommended. Auth cookies are marked secure in production, so without HTTPS logins won't persist correctly. Use Caddy or Nginx with Let's Encrypt; it's free and automatic.",
	},
	{
		q: "Can I disable public registration?",
		a: "Not via a config option currently, but you can restrict the /signup route at the reverse proxy level once you've created your account.",
	},
	{
		q: "Where do I report bugs or request features?",
		a: (
			<>
				Open an issue on{" "}
				<a
					href="https://github.com/syntheit/retrospend"
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary underline underline-offset-4"
				>
					GitHub
				</a>
				. For questions, join the{" "}
				<a
					href="https://matrix.to/#/#retrospend:matrix.org"
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary underline underline-offset-4"
				>
					Matrix room
				</a>
				.
			</>
		),
	},
	{
		q: "What is the difference between projects and just splitting?",
		a: "Projects group related shared expenses together and add features like billing periods, activity feeds, and per-project budgets. But you can split any expense without creating a project. Both approaches feed into the same per-person balance.",
	},
	{
		q: "Can I delete my account?",
		a: "Yes. Go to Settings and scroll to the bottom. You'll see a preview of what gets deleted (expense count, project count, etc.) before confirming. Deletion is permanent, so export your data first if you want a backup.",
	},
	{
		q: "Is there a mobile app?",
		a: "No native app, but Retrospend is fully responsive and works well in mobile browsers. You can add it to your home screen for an app-like experience.",
	},
	{
		q: "What are billing periods?",
		a: "Billing periods are time segments within a project. They let you close out and settle up for a specific window (like a month) without affecting the rest of the project. Useful for ongoing shared costs like rent.",
	},
	{
		q: "How do payment methods work for settlements?",
		a: "Configure your payment methods in Settings. When settling up, Retrospend shows methods you have in common with the other person and generates deep links where supported (Venmo, PayPal, etc.).",
	},
	{
		q: "Can I change my home currency?",
		a: "Yes, in Settings under App Preferences. Changing your home currency recalculates all totals and budgets using the stored exchange rates. Historical rates are preserved.",
	},
	{
		q: "How do I set up email notifications?",
		a: "Configure SMTP environment variables (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM) in your .env file. Then each user can manage their notification preferences in Settings.",
	},
	{
		q: "What does the sidecar service do?",
		a: "The sidecar is a Go service that handles background tasks: daily exchange rate sync, recurring expense generation, scheduled database backups, notification delivery, and AI-powered bank statement import.",
	},
]

export default function FaqPage() {
	const { prev, next } = getAdjacentDocs(slug)

	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">
					FAQ
				</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">
					Frequently Asked Questions
				</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					Common questions about using and self-hosting Retrospend.
				</p>
			</div>

			<Accordion type="multiple" className="mt-8 w-full">
				{FAQS.map((faq, i) => (
					<AccordionItem key={i} value={`item-${i}`}>
						<AccordionTrigger className="text-left text-sm font-medium leading-snug">
							{faq.q}
						</AccordionTrigger>
						<AccordionContent className="text-muted-foreground text-sm leading-relaxed">
							{faq.a}
						</AccordionContent>
					</AccordionItem>
				))}
			</Accordion>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
