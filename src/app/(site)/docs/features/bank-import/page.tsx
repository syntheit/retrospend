import type { Metadata } from "next"
import { Badge } from "~/components/ui/badge"
import { Card, CardContent } from "~/components/ui/card"
import { Callout } from "../../_components/callout"
import { BankImportDemoEmbed } from "../../_components/demo-embeds"
import { DocsNav } from "../../_components/docs-nav"
import { getAdjacentDocs } from "../../docs-config"

export const metadata: Metadata = {
	title: "Bank Import",
	description: "Import bank statements and CSV files with AI-powered categorization.",
}

const slug = "features/bank-import"

export default function BankImportPage() {
	const { prev, next } = getAdjacentDocs(slug)
	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">Features</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">Bank Import</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					Import transactions from bank statements or CSV files. AI handles categorization, and you review before importing.
				</p>
			</div>

			<BankImportDemoEmbed />

			<h2 id="two-import-modes" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Two Import Modes
			</h2>
			<p className="mb-4 text-muted-foreground leading-relaxed">
				Retrospend supports two ways to import transactions:
			</p>
			<div className="grid gap-3 sm:grid-cols-2">
				<Card className="border-primary/20 bg-primary/5">
					<CardContent className="p-4">
						<p className="font-semibold text-sm">Bank Statement (AI)</p>
						<p className="mt-1 text-muted-foreground text-sm">
							Upload a PDF or XLSX bank statement. Retrospend&apos;s AI extracts transactions,
							parses amounts and dates, and assigns categories automatically. Best for
							statements with complex formatting.
						</p>
					</CardContent>
				</Card>
				<Card className="border-border bg-card">
					<CardContent className="p-4">
						<p className="font-semibold text-sm">Retrospend CSV</p>
						<p className="mt-1 text-muted-foreground text-sm">
							Import a CSV file matching Retrospend&apos;s format (or exported from another
							Retrospend instance). Column mapping is automatic, so just upload and review.
						</p>
					</CardContent>
				</Card>
			</div>

			<h2 id="review-before-importing" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Review Before Importing
			</h2>
			<p className="mb-3 text-muted-foreground leading-relaxed">
				Both import modes show a review table before anything is saved. In the review table you can:
			</p>
			<ul className="mb-4 list-disc space-y-1.5 pl-6 text-muted-foreground text-sm leading-relaxed">
				<li><strong>Edit inline</strong>: click any cell to change the title, amount, date, or category</li>
				<li><strong>Check/uncheck rows</strong>: only checked rows will be imported</li>
				<li><strong>See duplicates</strong>: transactions that match existing expenses are flagged and auto-unchecked</li>
				<li><strong>Set bulk currency</strong>: override the currency for all rows at once</li>
			</ul>

			<h3 id="duplicate-detection" className="mt-8 mb-3 font-semibold text-lg scroll-mt-20">
				Duplicate Detection
			</h3>
			<p className="text-muted-foreground leading-relaxed">
				Retrospend generates a fingerprint for each transaction based on the date, title, amount,
				and currency. If a matching expense already exists in your account, the row is marked
				as &quot;Duplicate&quot; with a badge and automatically unchecked. You can still
				check it manually if you want to import it anyway.
			</p>

			<h2 id="ai-categorization" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				AI Categorization
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				When importing bank statements, the AI assigns a category to each transaction based on
				the merchant name and description. Categories use your existing category list, so
				everything stays consistent. You can always change the category in the review table
				before importing.
			</p>

			<h2 id="tips" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Tips
			</h2>
			<Callout variant="tip" title="Uncheck unwanted rows">
				Bank statements often include transfers between your own accounts, ATM withdrawals,
				or other non-expense transactions. Uncheck these in the review table to keep your
				expense log clean.
			</Callout>
			<Callout variant="tip" title="CSV vs PDF quality">
				CSV files import faster and more accurately because the data is already structured.
				PDF parsing depends on the statement&apos;s formatting. If a PDF import looks off,
				try downloading a CSV from your bank instead.
			</Callout>
			<Callout variant="info" title="Self-hosted AI">
				Bank statement parsing requires an LLM. Self-hosted users can use a local Ollama
				instance or configure an OpenRouter API key. See the{" "}
				<a href="/docs/configuration/ai-import" className="underline underline-offset-2">
					AI Import configuration
				</a>{" "}
				guide for setup details.
			</Callout>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
