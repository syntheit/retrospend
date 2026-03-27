"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { Badge } from "~/components/ui/badge"
import { DemoContainer } from "~/app/(site)/docs/_components/demo-container"

const LazySplitCalculator = dynamic(
	() => import("~/app/(site)/docs/_components/demo-split-calculator").then((m) => m.DemoSplitCalculator),
	{ ssr: false },
)

const LazyCurrencyConverter = dynamic(
	() => import("~/app/(site)/docs/_components/demo-currency-converter").then((m) => m.DemoCurrencyConverter),
	{ ssr: false },
)

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
				The biggest release yet. Retrospend goes from a personal expense tracker to
				a collaborative financial tool: split expenses with friends, organize
				shared costs into projects, invite anyone via magic links (no account needed),
				settle debts, and track who owes whom across every currency. This update also
				brings a redesigned UI, a full{" "}
				<DocLink href="/docs">documentation site</DocLink>, and over 100 new components.
			</p>

			{/* ── How It Works ── */}
			<Section title="How It All Fits Together">
				<p className="text-muted-foreground text-sm leading-relaxed">
					The new shared expense system is built around three concepts:
					{" "}<strong className="text-foreground">People</strong>,
					{" "}<strong className="text-foreground">Projects</strong>, and
					{" "}<strong className="text-foreground">Shared Transactions</strong>.
				</p>
				<div className="space-y-4 rounded-lg border border-border/60 bg-muted/30 p-4 text-sm">
					<div className="space-y-1">
						<p className="font-medium text-foreground">Standalone splits (no project needed)</p>
						<p className="text-muted-foreground">
							Paid for dinner? Create a shared expense, pick who was there, choose a split mode,
							and you&apos;re done. The balance shows up on your <DocLink href="/docs/features/people">People</DocLink> page
							immediately. When they pay you back, record a settlement.
						</p>
					</div>
					<div className="space-y-1">
						<p className="font-medium text-foreground">Trip or event (project with a start and end)</p>
						<p className="text-muted-foreground">
							Create a <DocLink href="/docs/features/projects">Trip project</DocLink>, invite
							your group via a magic link, and log expenses as you go. At the end, the settlement
							optimizer tells everyone who owes whom, minimizing the number of payments needed.
						</p>
					</div>
					<div className="space-y-1">
						<p className="font-medium text-foreground">Ongoing shared costs (roommates, couples)</p>
						<p className="text-muted-foreground">
							Create an Ongoing project with monthly billing periods. Expenses accumulate during the
							period, then you close it. Everyone verifies their share, settles up, and a
							new period opens automatically.
						</p>
					</div>
				</div>
				<p className="text-muted-foreground text-sm leading-relaxed">
					Balances are <strong className="text-foreground">person-centric</strong>: your net balance
					with someone rolls up across every project and standalone transaction, broken down by currency.
					You always know exactly how much you owe or are owed.
				</p>
			</Section>

			{/* ── Shared Expenses ── */}
			<Section title="Shared Expenses">
				<p className="text-muted-foreground text-sm leading-relaxed">
					Split any expense with other users, guests, or people who haven&apos;t signed up
					yet. Four split modes cover every scenario. <DocLink href="/docs/features/shared-expenses">Read the docs &rarr;</DocLink>
				</p>
				<div className="mt-2 flex flex-wrap gap-2">
					<Badge variant="secondary">Equal</Badge>
					<Badge variant="secondary">Exact Amounts</Badge>
					<Badge variant="secondary">Percentage</Badge>
					<Badge variant="secondary">Shares</Badge>
				</div>
				<FeatureList items={[
					"Participant picker with fuzzy search by name, email, or @username",
					"Shadow profiles for people without accounts — they claim their share when they sign up or join via magic link",
					"Verification workflow: participants accept or reject their share, with auto-accept after 7 days",
					"\"Edited\" indicator with revision count and amber dot for unseen changes",
					"Shared transactions appear in the main transactions table with a \"shared\" badge, total amount, and participant count",
				]} />
				<DemoContainer title="Split Calculator">
					<LazySplitCalculator />
				</DemoContainer>
			</Section>

			{/* ── Projects ── */}
			<Section title="Projects">
				<p className="text-muted-foreground text-sm leading-relaxed">
					Group shared expenses into projects with participants, budgets, billing
					periods, and activity feeds. <DocLink href="/docs/features/projects">Read the docs &rarr;</DocLink>
				</p>
				<Subsection title="Project Types">
					<FeatureList items={[
						"Trip — time-bounded with start/end dates and daily pacing",
						"Ongoing — recurring costs with configurable billing periods (weekly, bi-weekly, monthly, or custom)",
						"One-Time — a single large expense split among participants",
						"Solo — personal organizational bucket, single participant",
						"General — flexible catch-all for anything else",
					]} />
				</Subsection>
				<Subsection title="Roles & Permissions">
					<FeatureList items={[
						"Organizer — full control over project settings, participants, and billing",
						"Editor — can manage participants and transactions, but cannot change billing permissions",
						"Contributor — can add and edit their own transactions",
						"Viewer — read-only access to the project and its expenses",
					]} />
				</Subsection>
				<Subsection title="Billing Periods (Ongoing Projects)">
					<FeatureList items={[
						"Expenses accumulate during an open period, then the period is closed for review",
						"All participants verify their shares before the period can be settled",
						"Settlement locks all transactions — no further edits allowed",
						"Auto-close option: periods close automatically when their end date passes, and the next period opens",
						"CSV export of settlement plans per period",
					]} />
				</Subsection>
				<FeatureList items={[
					"Per-project budgets with currency selection and progress tracking",
					"Activity feed with a full audit trail of every change",
					"Category breakdown chart and spending statistics",
					"Invite links with QR codes and configurable role assignment",
					"Project images with upload and cropping",
				]} />
			</Section>

			{/* ── Guest Access ── */}
			<Section title="Guest Access">
				<p className="text-muted-foreground text-sm leading-relaxed">
					Invite anyone to a project with a magic link. No account required.
					10-second onboarding: name and email, that&apos;s it.
				</p>
				<FeatureList items={[
					"Magic link invitations with configurable expiration and max uses",
					"Guest sessions scoped to a single project — no access to anything else",
					"Guests can create expenses, verify shares, and view balances within their project",
					"Upgrade to a full account at any time — all data migrates automatically",
					"Shadow profiles claimed by matching email on signup",
					"Self-service data deletion at /guest-data for full data control",
				]} />
			</Section>

			{/* ── Settlements ── */}
			<Section title="Settlements">
				<p className="text-muted-foreground text-sm leading-relaxed">
					Record payments between participants to settle balances. The payer records a payment,
					the payee confirms receipt, and the settlement is finalized.
				</p>
				<FeatureList items={[
					"Two-step confirmation: payer records payment → payee confirms receipt → finalized and immutable",
					"Payee can reject a settlement if they didn't receive the payment — payer is notified and can re-initiate",
					"Auto-confirmation for guest and shadow participants who can't log in to confirm",
					"One-click \"Remind\" button to nudge someone who owes you about their outstanding balance",
					"Reminders for pending settlements (rate-limited: once per day, max 3 per settlement)",
					"Settle any amount — partial settlements are supported",
					"Multi-currency: settle per-currency balances independently with exchange rate tracking",
					"Group settlement optimizer computes the minimum payments to zero all balances",
					"Payment method matching with one-tap deep links (Venmo, PayPal, Cash App, and more)",
				]} />
			</Section>

			{/* ── People ── */}
			<Section title="People">
				<p className="text-muted-foreground text-sm leading-relaxed">
					A dedicated section for everyone you share expenses with. <DocLink href="/docs/features/people">Read the docs &rarr;</DocLink>
				</p>
				<FeatureList items={[
					"People page shows all contacts sorted by balance — who owes whom at a glance",
					"Per-currency net balances with direction indicators (they owe you / you owe them / settled)",
					"Person detail page: full transaction history, balance breakdown, shared projects, and settlement history",
					"Settle up directly from a person's page with suggested amounts per currency",
					"Payment link generation with QR codes for the other person's preferred payment methods",
					"Frequent split partners surfaced for quick access when creating new expenses",
				]} />
			</Section>

			<Divider />

			{/* ── Payment Methods ── */}
			<Section title="Payment Methods">
				<p className="text-muted-foreground text-sm leading-relaxed">
					Configure your payment methods in <DocLink href="/docs/features/settings">Settings</DocLink>.
					They&apos;re used when settling up and displayed on your public profile.
				</p>
				<FeatureList items={[
					"30+ methods: PayPal, Venmo, Zelle, Cash App, Wise, Revolut, N26, MercadoPago, NuBank, PIX, Bizum, crypto wallets, bank transfers, and more",
					"Crypto wallet support with network selection (ERC-20, TRC-20, Solana, Lightning, and more)",
					"Drag-and-drop reordering and visibility controls (Public, Friends Only, or Payment Only)",
					"Tap to settle up — opens directly in the payment app where supported",
				]} />
			</Section>

			{/* ── Public Profiles ── */}
			<Section title="Public Profiles & Payment Links">
				<FeatureList items={[
					"Public profile at /u/username with avatar, animated background, and payment methods",
					"Payment page at /pay/username with QR codes and copy-to-clipboard for all methods",
					"Customizable animated background with currency, crypto, or geometric symbol sets",
					"Dynamic OpenGraph images for social sharing",
				]} />
			</Section>

			{/* ── Notifications ── */}
			<Section title="Notifications">
				<p className="text-muted-foreground text-sm leading-relaxed">
					In-app and email notifications for shared expense activity.
				</p>
				<FeatureList items={[
					"Notification bell in the header with unread count",
					"10 types: expense split, expense edited/deleted, settlement received/confirmed/rejected, balance reminder, payment reminder, period closed, participant added",
					"Per-type preferences: toggle in-app and email independently",
					"One-click unsubscribe from any email notification",
					"Click any notification to jump directly to the relevant transaction or person",
				]} />
			</Section>

			<Divider />

			{/* ── Revision History ── */}
			<Section title="Revision History">
				<p className="text-muted-foreground text-sm leading-relaxed">
					Every edit to a shared transaction is tracked in an immutable audit log.
					Open the revision history drawer from any shared transaction to see the
					full timeline.
				</p>
				<FeatureList items={[
					"Timeline drawer shows every action — created, edited, verified, disputed, settled, and more",
					"Field-level diffs for edits: see exactly what changed with old and new values side by side",
					"Who made each change and when, with consecutive edits by the same person grouped together",
				]} />
			</Section>

			{/* ── Expense Form ── */}
			<Section title="Expense Form Redesign">
				<p className="text-muted-foreground text-sm leading-relaxed">
					The expense form has been rebuilt into modular sections with new input
					components. <DocLink href="/docs/features/transactions">Read the docs &rarr;</DocLink>
				</p>
				<Subsection title="Currency Amount Input">
					<FeatureList items={[
						"Arithmetic expressions — type \"12.50 + 8.75\" and it calculates the total",
						"Live conversion to your home currency with exchange rate override option",
					]} />
				</Subsection>
				<Subsection title="Category Chip Selector">
					<FeatureList items={[
						"Horizontal scrollable chips replace the old dropdown",
						"Search, filter, and create categories inline without leaving the form",
					]} />
				</Subsection>
				<Subsection title="Quick Actions">
					<FeatureList items={[
						"\"Today\" and \"Yesterday\" date chips alongside the full date picker",
						"Amortization presets (2, 3, 6, 12, 24 months) with calculated monthly amount",
						"Biweekly and quarterly recurring frequencies added",
					]} />
				</Subsection>
			</Section>

			{/* ── Currency Calculator ── */}
			<Section title="Currency Calculator">
				<p className="text-muted-foreground text-sm leading-relaxed">
					Bidirectional conversion on the <DocLink href="/docs/features/multi-currency">currencies page</DocLink>.
					Convert between any fiat or crypto currency using your stored rates.
				</p>
				<FeatureList items={[
					"Swap direction, select rate type, live conversion as you type",
					"Favorite currency cards with drag-and-drop reordering and right-click context menu",
				]} />
				<DemoContainer title="Currency Converter">
					<LazyCurrencyConverter />
				</DemoContainer>
			</Section>

			<Divider />

			{/* ── Settings Redesign ── */}
			<Section title="Settings Redesign">
				<p className="text-muted-foreground text-sm leading-relaxed">
					Completely restructured settings with sticky section navigation. <DocLink href="/docs/features/settings">Read the docs &rarr;</DocLink>
				</p>
				<FeatureList items={[
					"Profile: name, username (with change cooldown), and email with two-step verification",
					"Avatar upload with image cropping, or auto-generated initials",
					"Profile background customization with live preview",
					"Notification preferences: per-type toggles for in-app and email",
					"Payment methods management with drag-and-drop reordering",
					"Account deletion with multi-step confirmation and data impact preview",
				]} />
			</Section>

			{/* ── Feedback ── */}
			<Section title="Feedback System">
				<FeatureList items={[
					"Feedback button in the header — submit suggestions or bug reports without leaving the app",
					"Admins see all submissions in a dedicated panel with read/unread/archived status",
				]} />
			</Section>

			{/* ── Admin Panel ── */}
			<Section title="Admin Panel Updates">
				<FeatureList items={[
					"AI Usage tab: see per-user import usage and control who can use external AI",
					"Switch between local AI (Ollama) and external AI (OpenRouter) from the UI",
					"Account deletion now preserves historical data anonymously instead of hard deleting",
				]} />
			</Section>

			<Divider />

			{/* ── Documentation ── */}
			<Section title="Documentation Site">
				<p className="text-muted-foreground text-sm leading-relaxed">
					A full documentation site at <DocLink href="/docs">/docs</DocLink> with
					interactive demos, self-hosting guides, and configuration reference.
				</p>
				<FeatureList items={[
					"18 pages covering getting started, all features, self-hosting, and configuration",
					"Interactive demos for the dashboard, budgets, wealth, bank import, split calculator, and currency converter",
				]} />
			</Section>

			{/* ── Landing Page ── */}
			<Section title="Landing Page">
				<FeatureList items={[
					"Redesigned hero with session-aware CTAs and live feature demos",
					"Feature highlight cards for multi-currency, bank import, budgets, recurring detection, and wealth tracking",
				]} />
			</Section>

			<Divider />

			{/* ── Self-Hosting ── */}
			<Section title="Self-Hosting Updates">
				<p className="text-muted-foreground text-sm leading-relaxed">
					<DocLink href="/docs/self-hosting">Self-hosting docs &rarr;</DocLink>
				</p>
				<FeatureList items={[
					"The separate worker and importer containers have been merged into a single sidecar — simpler to deploy and configure",
					"Uploaded files (avatars, project images, receipts) are now stored on the local filesystem via a Docker volume — no external object storage needed",
					"Two-phase email changes, username change cooldown, and one-click email unsubscribe",
					"Daily automatic cleanup of expired sessions, old tokens, and inactive guests",
				]} />
			</Section>

			{/* ── Other ── */}
			<Section title="Other Changes">
				<FeatureList items={[
					"Command palette (Cmd+K) for quick navigation, actions, and live currency lookups",
					"Exchange rates page renamed to Currencies; favorite cards support drag-and-drop reordering and a right-click context menu",
					"Biweekly and quarterly options added to recurring expense frequencies",
					"\"Exclude from analytics\" toggle per expense (and as a default per category)",
					"App URLs simplified — /app/dashboard is now just /dashboard",
				]} />
			</Section>
		</div>
	)
}
