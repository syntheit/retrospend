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

export default function ReleaseV043() {
	return (
		<div className="space-y-10">
			<p className="text-muted-foreground leading-relaxed">
				Improvements to search, navigation, and UI polish across expenses,
				projects, people, and wealth tracking.
			</p>

			<Section title="Search & Navigation">
				<FeatureList items={[
					"Added search to expenses and recurring expenses pages",
					"Added filters and search to person pages",
					"More keyboard shortcuts, including / to search and project search in the quick switcher",
					"Expandable search component for a cleaner UI",
					"Moved action buttons from page headers to main content area",
				]} />
			</Section>

			<Section title="Projects & Settlements">
				<FeatureList items={[
					"Removed settle option for individual projects, cleaned up settlement logic",
					"Cleaned up currencies in the settle dialog",
					"Renamed \"organizer\" to \"owner\"",
					"Removed dates from projects",
					"Project settings destructive area cleanup",
					"Hide hamburger menu on projects card when unnecessary",
				]} />
			</Section>

			<Section title="People & Profiles">
				<FeatureList items={[
					"Avatar stacks on person pages and project cards",
					"Cash details on profile",
					"Improved shadow user to regular user onboarding flow",
					"Shadow profile updates",
					"Additional username validation",
				]} />
			</Section>

			<Divider />

			<Section title="Expenses & UI">
				<FeatureList items={[
					"Switched year/month picker to a MonthStepper component",
					"Cleaned up filter menu and table footer styling",
					"Fixed avatar loading bug in add/edit expense modals",
					"Fixed loading state for person pages with no common history",
					"Hide \"Who\" column when user has no shared expenses",
					"Date picker input sizing consistency",
					"Venmo and payment links fixes",
					"Feedback modal wording change",
				]} />
			</Section>

			<Section title="Wealth">
				<FeatureList items={[
					"Wealth page cleanup and updated demo components",
					"Fixed table alignments, balance masking, and asset percentage calculations",
				]} />
			</Section>

			<Divider />

			<Section title="Other">
				<FeatureList items={[
					"Live data invalidation",
					"Fixed invite link audit log bug",
					"Animation fixes",
					"Adjusted view for viewer role",
				]} />
			</Section>
		</div>
	)
}
