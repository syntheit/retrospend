"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "~/lib/utils"
import { DOCS_CONFIG } from "../docs-config"

interface DocsSidebarProps {
	onNavigate?: () => void
}

export function DocsSidebar({ onNavigate }: DocsSidebarProps) {
	const pathname = usePathname()
	const currentSlug = pathname.replace(/^\/docs\/?/, "") || "getting-started"

	return (
		<nav className="h-full overflow-y-auto py-6">
			<div className="space-y-6 px-3">
				{DOCS_CONFIG.map((section) => (
					<div key={section.slug}>
						<p className="mb-1.5 px-2 font-semibold text-muted-foreground text-xs tracking-wide">
							{section.title}
						</p>
						<ul className="space-y-0.5">
							{section.items.map((page) => {
								const isActive = currentSlug === page.slug
								return (
									<li key={page.slug}>
										<Link
											href={`/docs/${page.slug}`}
											onClick={onNavigate}
											className={cn(
												"block rounded-md px-2 py-1.5 text-sm transition-colors",
												isActive
													? "bg-primary/10 font-medium text-primary"
													: "text-muted-foreground hover:bg-muted hover:text-foreground",
											)}
										>
											{page.title}
										</Link>
									</li>
								)
							})}
						</ul>
					</div>
				))}
			</div>
		</nav>
	)
}
