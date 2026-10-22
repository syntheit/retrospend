"use client";

import { useTranslations } from "next-intl";
import { type RefObject, useCallback, useEffect, useState } from "react";
import { lineTab, lineTabOn, TabIndicator } from "~/components/ui/tabs";
import { cn } from "~/lib/cn";
import {
	activeSection,
	SECTION_ICONS,
	type SectionId,
	sectionFromHash,
} from "./sections";

/** Below the sticky phone tabs, so a section heading is never under them. */
const READING_LINE = 96;

function scrollBehavior(): ScrollBehavior {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches
		? "auto"
		: "smooth";
}

/**
 * The scroll spy and the jump: which section is in view inside `scroller`,
 * and a function that brings one to the top. Arriving with `#<section>`
 * scrolls there once.
 */
export function useSectionSpy(
	scroller: RefObject<HTMLElement | null>,
	ids: readonly SectionId[],
) {
	const [current, setCurrent] = useState<SectionId>(ids[0] ?? "profile");

	useEffect(() => {
		const root = scroller.current;
		if (!root) return;
		let frame = 0;
		const measure = () => {
			frame = 0;
			const base = root.getBoundingClientRect().top;
			const tops = ids.flatMap((id) => {
				const el = document.getElementById(id);
				return el ? [{ id, top: el.getBoundingClientRect().top - base }] : [];
			});
			const atEnd = root.scrollTop + root.clientHeight >= root.scrollHeight - 4;
			const next = activeSection(tops, READING_LINE, atEnd);
			if (next) setCurrent(next);
		};
		const onScroll = () => {
			if (!frame) frame = requestAnimationFrame(measure);
		};
		measure();
		root.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll);
		return () => {
			root.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onScroll);
			if (frame) cancelAnimationFrame(frame);
		};
	}, [scroller, ids]);

	const go = useCallback((id: SectionId) => {
		document
			.getElementById(id)
			?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
		history.replaceState(null, "", `#${id}`);
		setCurrent(id);
	}, []);

	// Arriving from the palette or a link: /settings#security.
	useEffect(() => {
		const id = sectionFromHash(window.location.hash);
		if (!id) return;
		const timer = setTimeout(
			() => document.getElementById(id)?.scrollIntoView({ block: "start" }),
			60,
		);
		return () => clearTimeout(timer);
	}, []);

	return { current, go };
}

type NavProps = {
	ids: readonly SectionId[];
	current: SectionId;
	onGo: (id: SectionId) => void;
};

/** Desktop: the sticky list beside the sections (layout A). */
export function SectionList({ ids, current, onGo }: NavProps) {
	const t = useTranslations("settingsV2.sections");
	return (
		<nav aria-label={t("label")} className="flex flex-col gap-0.5">
			{ids.map((id) => {
				const Icon = SECTION_ICONS[id];
				const on = id === current;
				return (
					<a
						aria-current={on ? "true" : undefined}
						className={cn(
							"flex h-ctl items-center gap-3 rounded-ctl px-3 font-medium text-body text-fg-2 transition-colors duration-(--t-state) focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 can-hover:hover:bg-raised can-hover:hover:text-fg",
							on && "bg-raised text-fg",
							id === "danger" && "mt-3",
						)}
						href={`#${id}`}
						key={id}
						onClick={(e) => {
							e.preventDefault();
							onGo(id);
						}}
					>
						<Icon
							aria-hidden="true"
							className={cn("size-4", on ? "text-fg" : "text-fg-3")}
						/>
						<span className="truncate">{t(id)}</span>
					</a>
				);
			})}
		</nav>
	);
}

/** Phone: sticky underline tabs that scroll sideways and follow the spy. */
export function SectionTabs({ ids, current, onGo }: NavProps) {
	const t = useTranslations("settingsV2.sections");
	useEffect(() => {
		document
			.querySelector(`[data-section-tab="${current}"]`)
			?.scrollIntoView({ block: "nearest", inline: "center" });
	}, [current]);
	return (
		<div className="sticky top-0 z-10 -mx-4 mb-4 bg-bg px-4">
			<nav
				aria-label={t("label")}
				className="relative flex items-stretch gap-6 overflow-x-auto border-line border-b [scrollbar-width:none]"
			>
				{ids.map((id) => {
					const on = id === current;
					return (
						<a
							aria-current={on ? "true" : undefined}
							className={cn(lineTab, on && lineTabOn)}
							data-section-tab={id}
							data-state={on ? "active" : "inactive"}
							href={`#${id}`}
							key={id}
							onClick={(e) => {
								e.preventDefault();
								onGo(id);
							}}
						>
							{t(id)}
						</a>
					);
				})}
				<TabIndicator />
			</nav>
		</div>
	);
}
