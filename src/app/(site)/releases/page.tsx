import { ReleaseEntryCard } from "./_components/release-entry"
import { RELEASES } from "./_components/releases-config"

export default function ReleasesPage() {
	return (
		<div className="space-y-16">
			<div>
				<h1 className="font-bold text-3xl tracking-tight sm:text-4xl">
					Release Notes
				</h1>
				<p className="mt-2 text-muted-foreground">
					New features, improvements, and fixes for Retrospend.
				</p>
			</div>

			{RELEASES.map((release) => (
				<ReleaseEntryCard key={release.version} release={release} />
			))}
		</div>
	)
}
