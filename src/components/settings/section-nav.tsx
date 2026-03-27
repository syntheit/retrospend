"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

interface Section {
	id: string;
	label: string;
}

export function SectionNav({ sections }: { sections: Section[] }) {
	const [activeId, setActiveId] = useState(sections[0]?.id ?? "");
	const navRef = useRef<HTMLDivElement>(null);
	const isScrollingRef = useRef(false);

	useEffect(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				if (isScrollingRef.current) return;
				for (const entry of entries) {
					if (entry.isIntersecting) {
						setActiveId(entry.target.id);
					}
				}
			},
			{ rootMargin: "-100px 0px -70% 0px" },
		);

		for (const section of sections) {
			const el = document.getElementById(section.id);
			if (el) observer.observe(el);
		}

		return () => observer.disconnect();
	}, [sections]);

	const scrollTo = (id: string) => {
		const el = document.getElementById(id);
		if (!el) return;
		setActiveId(id);
		isScrollingRef.current = true;

		// Find the nearest scrollable ancestor (PageContent's overflow-y-auto div)
		// to avoid scrollIntoView bubbling up and shifting the outer layout.
		let scrollContainer: HTMLElement | null = el.parentElement;
		while (scrollContainer) {
			const overflow = getComputedStyle(scrollContainer).overflowY;
			if (overflow === "auto" || overflow === "scroll") break;
			scrollContainer = scrollContainer.parentElement;
		}

		if (scrollContainer) {
			const containerTop = scrollContainer.getBoundingClientRect().top;
			const elTop = el.getBoundingClientRect().top;
			const offset = elTop - containerTop + scrollContainer.scrollTop;
			// 64px accounts for scroll-mt-16 on sections
			scrollContainer.scrollTo({ top: offset - 64, behavior: "smooth" });
		} else {
			el.scrollIntoView({ behavior: "smooth", block: "start" });
		}

		setTimeout(() => {
			isScrollingRef.current = false;
		}, 800);
	};

	return (
		<nav
			ref={navRef}
			className="sticky top-0 z-10 overflow-x-auto rounded-lg border border-border bg-background shadow-sm [&::-webkit-scrollbar]:hidden"
			style={{ scrollbarWidth: "none" }}
		>
			<div className="flex gap-1 px-1 py-1.5">
				{sections.map((section) => (
					<Button
						key={section.id}
						type="button"
						onClick={() => scrollTo(section.id)}
						className={cn(
							"whitespace-nowrap px-3 py-1.5 text-sm",
							activeId === section.id
								? "bg-accent text-accent-foreground"
								: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
						)}
						variant="ghost"
						size="sm"
					>
						{section.label}
					</Button>
				))}
			</div>
		</nav>
	);
}
