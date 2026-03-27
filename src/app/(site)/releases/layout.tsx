import type { Metadata } from "next"
import { Suspense, type ReactNode } from "react"
import { ReleasesHeader } from "./_components/releases-header"

export const metadata: Metadata = {
	title: {
		template: "%s - Retrospend Releases",
		default: "Release Notes - Retrospend Releases",
	},
	description: "See what's new in Retrospend — features, improvements, and fixes.",
}

export default function ReleasesLayout({ children }: { children: ReactNode }) {
	return (
		<div className="flex h-screen flex-col">
			<Suspense>
				<ReleasesHeader />
			</Suspense>
			<main className="flex-1 overflow-y-auto">
				<div className="mx-auto max-w-3xl px-6 py-10 pb-20">
					{children}
				</div>
			</main>
		</div>
	)
}
