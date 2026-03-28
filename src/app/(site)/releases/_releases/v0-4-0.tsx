"use client"

import Link from "next/link"
import { Badge } from "~/components/ui/badge"

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="space-y-3">
			<h3 className="font-semibold text-lg tracking-tight">{title}</h3>
			{children}
		</section>
	)
}

function Subsection({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="space-y-2">
			<h4 className="font-medium text-sm text-foreground">{title}</h4>
			{children}
		</div>
	)
}

function FeatureList({ items }: { items: string[] }) {
	return (
		<ul className="space-y-1.5 text-muted-foreground text-sm">
			{items.map((item) => (
				<li key={item} className="flex gap-2">
					<span className="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
					<span>{item}</span>
				</li>
			))}
		</ul>
	)
}

function Divider() {
	return <hr className="border-border/60" />
}

const screenshotBase = "/releases/v0-4-0"

function Screenshot({ src, alt }: { src: string; alt: string }) {
	return (
		<img
			src={`${screenshotBase}/${src}`}
			alt={alt}
			className="rounded-lg border border-border/60"
		/>
	)
}

function DocLink({ href, children }: { href: string; children: React.ReactNode }) {
	return (
		<Link href={href} className="font-medium text-primary underline underline-offset-4 hover:text-primary/80">
			{children}
		</Link>
	)
}

export default function ReleaseV040() {
	return (
		<div className="space-y-10">
			<p className="text-muted-foreground leading-relaxed">
				This release adds shared expenses, projects, and settlements. You can now
				split costs with other people, organize them into projects, invite
				participants via link, and settle balances. There&apos;s also a new{" "}
				<DocLink href="/docs">documentation site</DocLink>, redesigned settings,
				and a rebuilt expense form.
			</p>

			{/* ── How It Works ── */}
			<Section title="Shared Expenses Overview">
				<p className="text-muted-foreground text-sm leading-relaxed">
					Shared expenses work around three concepts:
					{" "}<strong className="text-foreground">People</strong> (who you split with),
					{" "}<strong className="text-foreground">Projects</strong> (optional grouping for expenses), and
					{" "}<strong className="text-foreground">Shared Transactions</strong> (the actual splits).
					You can use them independently or together.
				</p>
				<div className="space-y-4 rounded-lg border border-border/60 bg-muted/30 p-4 text-sm">
					<div className="space-y-1">
						<p className="font-medium text-foreground">Quick splits</p>
						<p className="text-muted-foreground">
							Create a shared expense directly from any transaction. Pick participants, choose
							how to split (equal, exact amounts, percentage, or shares), done. The balance
							shows up on the <DocLink href="/docs/features/people">People</DocLink> page.
						</p>
					</div>
					<div className="space-y-1">
						<p className="font-medium text-foreground">Trips and events</p>
						<p className="text-muted-foreground">
							For a trip or event, create a <DocLink href="/docs/features/projects">project</DocLink> with
							start/end dates. Everyone logs expenses as they go. At the end, the settlement
							optimizer calculates the minimum number of payments to settle all balances.
						</p>
					</div>
					<div className="space-y-1">
						<p className="font-medium text-foreground">Recurring shared costs</p>
						<p className="text-muted-foreground">
							For roommates or ongoing shared costs, use an Ongoing project with billing periods.
							Expenses accumulate during the period. When the period closes, everyone
							verifies their share and settles up. The next period opens automatically.
						</p>
					</div>
				</div>
				<p className="text-muted-foreground text-sm leading-relaxed">
					Balances are tracked per person across all projects and standalone splits,
					broken down by currency.
				</p>
			</Section>

			{/* ── Shared Expenses ── */}
			<Section title="Split Modes">
				<p className="text-muted-foreground text-sm leading-relaxed">
					Four ways to split an expense. <DocLink href="/docs/features/shared-expenses">Docs &rarr;</DocLink>
				</p>
				<div className="mt-2 flex flex-wrap gap-2">
					<Badge variant="secondary">Equal</Badge>
					<Badge variant="secondary">Exact Amounts</Badge>
					<Badge variant="secondary">Percentage</Badge>
					<Badge variant="secondary">Shares</Badge>
				</div>
				<FeatureList items={[
					"Participant picker with search by name, email, or @username",
					"Shadow profiles for people without accounts, claimed when they sign up or join via invite link",
					"Participants verify their share (auto-accepted after 7 days if no action taken)",
					"Shared transactions appear in the main table with participant count and total",
				]} />
				<Screenshot src="add-expense-pizza-split-evenly.png" alt="Splitting a pizza expense evenly" />
			</Section>

			{/* ── Projects ── */}
			<Section title="Projects">
				<p className="text-muted-foreground text-sm leading-relaxed">
					Projects group shared expenses together with participants, budgets, and
					an activity feed. <DocLink href="/docs/features/projects">Docs &rarr;</DocLink>
				</p>
				<Subsection title="Project Types">
					<FeatureList items={[
						"Trip: start/end dates with daily budget pacing",
						"Ongoing: recurring billing periods (weekly, bi-weekly, monthly, or custom)",
						"One-Time: single expense split among participants",
						"Solo: personal bucket, one participant",
						"General: no specific structure",
					]} />
				</Subsection>
				<Subsection title="Roles">
					<FeatureList items={[
						"Owner: full control over settings, participants, and billing",
						"Editor: manage participants and transactions",
						"Contributor: add and edit own transactions",
						"Viewer: read-only",
					]} />
				</Subsection>
				<Subsection title="Billing Periods (Ongoing Projects)">
					<p className="text-muted-foreground text-sm leading-relaxed">
						Expenses accumulate during an open period. When the period closes,
						participants verify their shares, then settle up. Settlement locks
						all transactions in that period. Periods can auto-close when their
						end date passes. Settlement plans are exportable as CSV.
					</p>
				</Subsection>
				<FeatureList items={[
					"Per-project budgets with progress tracking",
					"Activity feed with audit trail",
					"Category breakdown and spending stats",
					"Invite links with QR codes and role assignment",
				]} />
				<Screenshot src="ongoing-project-overview.png" alt="Ongoing project overview" />
			</Section>

			{/* ── Guest Access ── */}
			<Section title="Guest Access">
				<p className="text-muted-foreground text-sm leading-relaxed">
					Project participants don&apos;t need an account. They join via invite link
					by entering a name and email. Guests can add expenses, verify shares,
					and view balances within their project. They can upgrade to a full account
					later, and all data carries over.
				</p>
				<Screenshot src="project-share-modal.png" alt="Project share modal with invite link" />
			</Section>

			{/* ── Settlements ── */}
			<Section title="Settlements">
				<p className="text-muted-foreground text-sm leading-relaxed">
					Settlements record payments between participants. The flow is: payer records
					a payment, payee confirms receipt, done. Payees can reject if they didn&apos;t
					receive payment.
				</p>
				<FeatureList items={[
					"Partial settlements supported, settle any amount",
					"Per-currency balances settled independently",
					"Settlement optimizer calculates the minimum payments to zero all balances in a project",
					"Auto-confirmation for guests who can&apos;t log in",
					"Remind button for outstanding balances (rate-limited)",
					"Payment method matching with deep links to payment apps",
				]} />
				<Screenshot src="settle-up.png" alt="Settle up view" />
			</Section>

			{/* ── People ── */}
			<Section title="People">
				<p className="text-muted-foreground text-sm leading-relaxed">
					The <DocLink href="/docs/features/people">People page</DocLink> shows everyone
					you share expenses with, sorted by balance. Each person has a detail page
					with transaction history, balance breakdown by currency, shared projects,
					and settlement history. You can settle up directly from there.
				</p>
				<Screenshot src="person-overview.png" alt="Person overview with balances" />
			</Section>

			<Divider />

			{/* ── Payment Methods ── */}
			<Section title="Payment Methods">
				<p className="text-muted-foreground text-sm leading-relaxed">
					Add your payment methods in <DocLink href="/docs/features/settings">settings</DocLink>.
					They show up when settling and on your public profile.
					Supports PayPal, Venmo, Zelle, Cash App, Wise, Revolut, crypto wallets,
					bank transfers, and more. Drag-and-drop to reorder, with visibility controls
					(public, friends only, or payment only).
				</p>
			</Section>

			{/* ── Public Profiles ── */}
			<Section title="Public Profiles">
				<p className="text-muted-foreground text-sm leading-relaxed">
					Public profile at /u/username showing avatar and payment methods.
					Separate payment page at /pay/username with QR codes.
					Customizable animated background.
				</p>
			</Section>

			{/* ── Notifications ── */}
			<Section title="Notifications">
				<p className="text-muted-foreground text-sm leading-relaxed">
					In-app and email notifications for shared expense events: splits, edits,
					settlements, reminders, billing period closures. Per-type toggles for
					in-app and email in settings. Click a notification to go to the relevant
					transaction or person.
				</p>
			</Section>

			<Divider />

			{/* ── Command Palette ── */}
			<Section title="Command Palette">
				<p className="text-muted-foreground text-sm leading-relaxed">
					Press Cmd+K (or Ctrl+K) to open the command palette. Navigate to any page,
					run actions, or look up live currency rates without leaving the keyboard.
				</p>
			</Section>

			{/* ── Expense Form ── */}
			<Section title="Expense Form">
				<p className="text-muted-foreground text-sm leading-relaxed">
					Rebuilt expense form. <DocLink href="/docs/features/transactions">Docs &rarr;</DocLink>
				</p>
				<FeatureList items={[
					"Currency input supports arithmetic (\"12.50 + 8.75\") with live conversion to home currency",
					"Category selector uses horizontal scrollable chips instead of a dropdown",
					"\"Today\" and \"Yesterday\" date shortcuts",
					"Amortization presets (2, 3, 6, 12, 24 months)",
					"Biweekly and quarterly recurring frequencies",
				]} />
			</Section>

			{/* ── Settings Redesign ── */}
			<Section title="Settings">
				<p className="text-muted-foreground text-sm leading-relaxed">
					Restructured settings page with sticky section navigation. <DocLink href="/docs/features/settings">Docs &rarr;</DocLink>
				</p>
				<FeatureList items={[
					"Username changes with cooldown, email changes with two-step verification",
					"Avatar upload with cropping",
					"Profile background customization",
					"Notification and payment method management",
					"Account deletion with data impact preview",
				]} />
			</Section>

			<Divider />

			{/* ── Documentation ── */}
			<Section title="Documentation">
				<p className="text-muted-foreground text-sm leading-relaxed">
					New documentation site at <DocLink href="/docs">/docs</DocLink> with
					interactive demos, self-hosting guides, and configuration reference.
				</p>
			</Section>

			{/* ── Self-Hosting ── */}
			<Section title="Self-Hosting">
				<p className="text-muted-foreground text-sm leading-relaxed">
					<DocLink href="/docs/self-hosting">Self-hosting docs &rarr;</DocLink>
				</p>
				<FeatureList items={[
					"Worker and importer containers merged into a single sidecar",
					"File uploads (avatars, project images, receipts) stored on local filesystem via Docker volume, no external object storage needed",
					"Daily cleanup of expired sessions, old tokens, and inactive guests",
				]} />
			</Section>

			{/* ── Other ── */}
			<Section title="Other">
				<FeatureList items={[
					"Revision history for shared transactions with field-level diffs",
					"Feedback button in the header for submitting suggestions or bug reports",
					"Exchange rates page renamed to Currencies",
					"\"Exclude from analytics\" toggle per expense and per category",
					"App URLs simplified: /app/dashboard is now /dashboard",
					"Admin: AI usage tracking, provider switching (Ollama / OpenRouter), anonymous account deletion",
				]} />
			</Section>
		</div>
	)
}
