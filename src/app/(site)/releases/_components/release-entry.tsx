import { Badge } from "~/components/ui/badge"
import type { ReleaseEntry } from "./releases-config"

function formatDate(dateStr: string) {
	const date = new Date(dateStr + "T00:00:00")
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	})
}

export function ReleaseEntryCard({ release }: { release: ReleaseEntry }) {
	const Component = release.component

	return (
		<article id={`v${release.version}`} className="scroll-mt-20">
			<div className="flex flex-wrap items-center gap-3">
				<Badge variant="outline" className="font-mono text-sm">
					v{release.version}
				</Badge>
				<span className="text-muted-foreground text-sm">
					{formatDate(release.date)}
				</span>
			</div>
			<h2 className="mt-2 font-bold text-2xl tracking-tight sm:text-3xl">
				{release.title}
			</h2>
			<div className="mt-6">
				<Component />
			</div>
		</article>
	)
}
