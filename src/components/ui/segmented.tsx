"use client";

import {
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { cn } from "~/lib/cn";

export type SegmentedOption<T extends string> = {
	value: T;
	label: string;
	disabled?: boolean;
	/** A bare glyph before the label (the composer's modes). */
	icon?: ReactNode;
};

/** The next enabled option for an arrow key, wrapping at the ends. */
export function nextEnabled<T extends string>(
	options: SegmentedOption<T>[],
	from: number,
	step: 1 | -1,
): number {
	for (let i = 1; i <= options.length; i++) {
		const at = (from + step * i + options.length) % options.length;
		if (!options[at]?.disabled) return at;
	}
	return from;
}

/**
 * Segmented (R7, R21): switch views of the same data in place, 2 to 4
 * options. A raised track with a 2px inset; the selected segment is surface
 * with shadow-ctl, and it slides to the chosen option (token motion, no
 * slide on reduced motion). Text, or a bare glyph before the text; the same
 * selected state for every option. It never navigates: sibling pages use
 * PageTabs.
 */
export function Segmented<T extends string>({
	options,
	value,
	onChange,
	label,
	full = false,
	className,
}: {
	options: SegmentedOption<T>[];
	value: T;
	onChange: (value: T) => void;
	/** Accessible name of the group (what is being switched). */
	label: string;
	/** Stretch to the container width (phone sheets). */
	full?: boolean;
	className?: string;
}) {
	const refs = useRef<(HTMLButtonElement | null)[]>([]);
	const current = options.findIndex((o) => o.value === value);
	// The selected surface is one thumb that slides between the options.
	const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
	const [slides, setSlides] = useState(false);
	const measure = () => {
		const el = refs.current[current];
		setThumb(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: measures when the choice or the options change
	useLayoutEffect(measure, [current, options.length]);
	// The first placement is not a slide.
	useEffect(() => {
		if (thumb) setSlides(true);
	}, [thumb]);
	const track = useRef<HTMLDivElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: measure reads the current index
	useEffect(() => {
		const el = track.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [current]);

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		const step =
			e.key === "ArrowRight" || e.key === "ArrowDown"
				? 1
				: e.key === "ArrowLeft" || e.key === "ArrowUp"
					? -1
					: 0;
		if (!step) return;
		e.preventDefault();
		const at = nextEnabled(options, Math.max(current, 0), step);
		const next = options[at];
		if (!next) return;
		onChange(next.value);
		refs.current[at]?.focus();
	};

	return (
		<div
			aria-label={label}
			className={cn(
				"h-ctl rounded-ctl bg-raised relative max-w-full items-stretch gap-0.5 p-0.5",
				full ? "flex" : "inline-flex",
				className,
			)}
			onKeyDown={onKeyDown}
			ref={track}
			role="radiogroup"
		>
			{thumb ? (
				<span
					aria-hidden="true"
					className={cn(
						"rounded-ctl bg-surface shadow-ctl ease-land absolute top-0.5 bottom-0.5 left-0",
						slides &&
							"transition-[translate,width] duration-(--t-tab) motion-reduce:transition-none",
					)}
					style={{ translate: `${thumb.x}px 0`, width: thumb.w }}
				/>
			) : null}
			{options.map((o, i) => {
				const on = o.value === value;
				return (
					<button
						aria-checked={on}
						className={cn(
							"rounded-ctl text-body text-fg-2 ease-land relative inline-flex flex-1 cursor-pointer items-center justify-center gap-2 px-3 font-medium whitespace-nowrap transition-colors duration-(--t-state) [&_svg]:size-4 [&_svg]:shrink-0",
							"focus-visible:outline-brand focus-visible:outline-2 focus-visible:outline-offset-2",
							"disabled:cursor-not-allowed disabled:opacity-45",
							on
								? cn("text-fg", !thumb && "bg-surface shadow-ctl")
								: "can-hover:hover:text-fg",
						)}
						disabled={o.disabled}
						key={o.value}
						onClick={() => onChange(o.value)}
						ref={(el) => {
							refs.current[i] = el;
						}}
						role="radio"
						tabIndex={on || (current < 0 && i === 0) ? 0 : -1}
						type="button"
					>
						{o.icon}
						{o.label}
					</button>
				);
			})}
		</div>
	);
}
