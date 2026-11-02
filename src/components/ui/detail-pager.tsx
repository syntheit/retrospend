"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { Tip } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

export type DetailTab = {
	id: string;
	label: string;
	icon: ReactNode;
	/** Tooltip and spoken name: the name plus its shortcut. */
	tip: string;
	/** A small dot: this answer is not at its default. */
	dot?: boolean;
	panel: ReactNode;
};

/**
 * DetailPager (provisional, composer design D): a fixed grid of equal
 * icon-over-word tabs and one panel per tab. On a phone the panels sit in a
 * snap-scrolling row (swipe or pick a tab). From md up the panels share one
 * cell and slide: the chosen one rests, the others wait to its left or right
 * (hidden), so the tabs and the frame never move or change height and the
 * switch is one 220ms slide. Reduced motion: opacity only. Left and Right
 * move between tabs.
 */
export function DetailPager({
	tabs,
	active,
	onActive,
	label,
	className,
}: {
	tabs: readonly DetailTab[];
	active: string;
	onActive: (id: string) => void;
	label: string;
	className?: string;
}) {
	const row = useRef<HTMLDivElement>(null);
	const lock = useRef<ReturnType<typeof setTimeout> | null>(null);
	const index = Math.max(
		0,
		tabs.findIndex((t) => t.id === active),
	);
	// A tab pick slides the row; its own scroll events must not pick again.
	// biome-ignore lint/correctness/useExhaustiveDependencies: slides only when the chosen tab changes
	useEffect(() => {
		const el = row.current;
		if (!el || el.scrollWidth <= el.clientWidth) return;
		const left = index * el.clientWidth;
		if (Math.abs(el.scrollLeft - left) < 2) return;
		if (lock.current) clearTimeout(lock.current);
		lock.current = setTimeout(() => {
			lock.current = null;
		}, 450);
		const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		el.scrollTo({ left, behavior: calm ? "auto" : "smooth" });
	}, [index]);
	const onScroll = () => {
		const el = row.current;
		if (!el || lock.current || el.clientWidth === 0) return;
		const at = Math.round(el.scrollLeft / el.clientWidth);
		const tab = tabs[at];
		if (tab && tab.id !== active) onActive(tab.id);
	};
	const onKeyDown = (e: React.KeyboardEvent) => {
		const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
		if (!step) return;
		const next = tabs[(index + step + tabs.length) % tabs.length];
		if (!next) return;
		e.preventDefault();
		onActive(next.id);
		document.getElementById(`tab-${next.id}`)?.focus();
	};
	return (
		<div className={cn("flex min-w-0 flex-col gap-3", className)}>
			<div
				aria-label={label}
				className="grid auto-cols-fr grid-flow-col gap-1"
				onKeyDown={onKeyDown}
				role="tablist"
			>
				{tabs.map((t) => {
					const on = t.id === active;
					return (
						<Tip content={t.tip} key={t.id}>
							<button
								aria-controls={`panel-${t.id}`}
								aria-label={t.tip}
								aria-selected={on}
								className={cn(
									"rounded-ctl focus-visible:outline-brand relative flex min-h-11 min-w-0 cursor-pointer flex-col items-center justify-center gap-1 px-1 py-2 transition-colors duration-(--t-state) focus-visible:outline-2 focus-visible:outline-offset-2 [&_svg]:size-4",
									on
										? "bg-brand-soft text-fg"
										: "text-fg-2 can-hover:hover:bg-raised",
								)}
								id={`tab-${t.id}`}
								onClick={() => onActive(t.id)}
								role="tab"
								tabIndex={on ? 0 : -1}
								type="button"
							>
								<span className="relative">
									{t.icon}
									{t.dot ? (
										<span
											aria-hidden="true"
											className="bg-ds-accent absolute -top-1 -right-2 size-1.5 rounded-full"
										/>
									) : null}
								</span>
								<span className="text-meta max-w-full truncate">{t.label}</span>
							</button>
						</Tip>
					);
				})}
			</div>
			<div
				className="flex items-start max-md:snap-x max-md:snap-mandatory max-md:overflow-x-auto md:-mx-1 md:grid md:overflow-x-clip md:px-1"
				onScroll={onScroll}
				ref={row}
			>
				{tabs.map((t, i) => (
					<div
						aria-labelledby={`tab-${t.id}`}
						className={cn(
							"w-full min-w-0 shrink-0 snap-center md:col-start-1 md:row-start-1",
							"md:ease-land md:transition-[translate,opacity,visibility] md:duration-(--t-tab)",
							// Waiting panels sit a full width to the side, hidden and out of the tab order.
							t.id !== active && "md:invisible md:opacity-0",
							i < index &&
								"md:-translate-x-full md:motion-reduce:translate-x-0",
							i > index && "md:translate-x-full md:motion-reduce:translate-x-0",
						)}
						id={`panel-${t.id}`}
						// The waiting panels leave the tab order and the accessibility tree at once, while the chosen one is still sliding in.
						inert={t.id !== active}
						key={t.id}
						role="tabpanel"
					>
						{t.panel}
					</div>
				))}
			</div>
		</div>
	);
}
