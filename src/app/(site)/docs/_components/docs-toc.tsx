"use client"

import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { cn } from "~/lib/utils"

type TocItem = {
	id: string
	label: string
	level: 2 | 3
}

export function DocsToc() {
	const pathname = usePathname()
	const [items, setItems] = useState<TocItem[]>([])
	const [activeId, setActiveId] = useState<string>("")

	// Scan DOM for headings whenever the page changes
	useEffect(() => {
		const timer = setTimeout(() => {
			const headings = document.querySelectorAll<HTMLElement>(
				"#docs-main h2[id], #docs-main h3[id]",
			)
			setItems(
				Array.from(headings).map((el) => ({
					id: el.id,
					label: el.textContent ?? "",
					level: el.tagName === "H2" ? 2 : 3,
				})),
			)
			setActiveId("")
		}, 50)
		return () => clearTimeout(timer)
	}, [pathname])

	// Track active heading via scroll position
	useEffect(() => {
		if (items.length === 0) return
		const scrollEl = document.getElementById("docs-main")
		if (!scrollEl) return

		const handleScroll = () => {
			const containerTop = scrollEl.getBoundingClientRect().top
			let current = ""
			for (const item of items) {
				const el = document.getElementById(item.id)
				if (!el) continue
				const rect = el.getBoundingClientRect()
				if (rect.top - containerTop <= 88) {
					current = item.id
				}
			}
			setActiveId(current)
		}

		scrollEl.addEventListener("scroll", handleScroll, { passive: true })
		handleScroll()
		return () => scrollEl.removeEventListener("scroll", handleScroll)
	}, [items])

	if (items.length === 0) return null

	return (
		<div className="sticky top-0 py-8">
			<p className="mb-3 font-semibold text-muted-foreground text-xs tracking-wide">
				On this page
			</p>
			<ul className="space-y-1.5">
				{items.map((item) => (
					<li key={item.id}>
						<a
							href={`#${item.id}`}
							className={cn(
								"block text-sm leading-snug transition-colors",
								item.level === 3 && "pl-3",
								activeId === item.id
									? "font-medium text-primary"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{item.label}
						</a>
					</li>
				))}
			</ul>
		</div>
	)
}
