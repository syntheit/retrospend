import type { Metadata } from "next"
import { Suspense, type ReactNode } from "react"
import { DocsHeader } from "./_components/docs-header"
import { DocsSidebar } from "./_components/docs-sidebar"
import { DocsToc } from "./_components/docs-toc"

export const metadata: Metadata = {
	title: {
		template: "%s - Retrospend Docs",
		default: "Retrospend Docs",
	},
	description: "Documentation for Retrospend: expenses, budgets, and wealth tracking.",
}

export default function DocsLayout({ children }: { children: ReactNode }) {
	return (
		<div className="flex h-screen flex-col">
			<Suspense>
				<DocsHeader />
			</Suspense>
			<div className="flex min-h-0 flex-1">
				{/* Left sidebar - desktop */}
				<aside className="hidden w-60 shrink-0 border-r border-border lg:flex lg:flex-col">
					<DocsSidebar />
				</aside>

				{/* Main content */}
				<main
					id="docs-main"
					className="flex-1 overflow-y-auto"
				>
					<div className="mx-auto max-w-3xl px-6 py-10 pb-20">
						{children}
					</div>
				</main>

				{/* Right TOC - wide desktop */}
				<aside className="hidden w-52 shrink-0 border-l border-border px-5 xl:block">
					<DocsToc />
				</aside>
			</div>
		</div>
	)
}
