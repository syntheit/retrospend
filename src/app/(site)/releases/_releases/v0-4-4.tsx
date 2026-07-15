"use client"

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="space-y-3">
			<h3 className="font-semibold text-lg tracking-tight">{title}</h3>
			{children}
		</section>
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

export default function ReleaseV044() {
	return (
		<div className="space-y-10">
			<p className="text-muted-foreground leading-relaxed">
				Retrospend now speaks Spanish as well as English, the dashboard is
				rebuilt around widgets you arrange yourself, and project types are gone
				so every feature is available in every project.
			</p>

			<Section title="Languages">
				<p className="text-muted-foreground text-sm leading-relaxed">
					The whole app is now translated. Pick your language in settings and
					it applies everywhere, per user.
				</p>
				<FeatureList items={[
					"Full English and Spanish translations across the app (around 2,500 strings)",
					"Language is a per-user setting, so each account can choose its own",
				]} />
			</Section>

			<Section title="Dashboard Widgets">
				<p className="text-muted-foreground text-sm leading-relaxed">
					The dashboard is now a grid of widgets you can rearrange. Drag them
					into the layout that suits you and add only the ones you care about.
				</p>
				<FeatureList items={[
					"Drag-and-drop grid you can arrange however you like",
					"Safe to spend, spending heatmap, and net worth snapshot",
					"Savings rate, monthly comparison, and monthly summary",
					"People balances, pending actions, and upcoming recurring",
					"Recent activity, category breakdown, and budget pacing",
					"Currency watchlist",
				]} />
			</Section>

			<Section title="Projects">
				<p className="text-muted-foreground text-sm leading-relaxed">
					Project types are gone. Every feature is now available in every
					project, so there is no mode to pick and no switching between them.
				</p>
				<FeatureList items={[
					"Removed project types (Trip, Ongoing, One-Time, Solo, General)",
					"Budgets, billing periods, settlements, and everything else work in any project",
				]} />
			</Section>

			<Divider />

			<Section title="Fixes & Improvements">
				<FeatureList items={[
					"Sessions now last 60 days, so no more surprise logouts after about a week",
					"Person pages now show expenses someone paid entirely on your behalf, even when you weren't part of the split",
					"Sticky table headers stay opaque instead of turning transparent while scrolling",
					"EUR now shows the EU flag",
					"Dependency upgrades under the hood",
				]} />
			</Section>
		</div>
	)
}
