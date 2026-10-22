"use client";

import { type KeyboardEvent, useRef } from "react";
import { cn } from "~/lib/cn";

export type SegmentedOption<T extends string> = {
	value: T;
	label: string;
	disabled?: boolean;
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
 * with shadow-ctl. Text only, the same selected state for every option. It
 * never navigates: sibling pages use PageTabs.
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
				"h-ctl max-w-full items-stretch gap-0.5 rounded-ctl bg-raised p-0.5",
				full ? "flex" : "inline-flex",
				className,
			)}
			onKeyDown={onKeyDown}
			role="radiogroup"
		>
			{options.map((o, i) => {
				const on = o.value === value;
				return (
					<button
						aria-checked={on}
						className={cn(
							"inline-flex flex-1 cursor-pointer items-center justify-center whitespace-nowrap rounded-ctl px-3 font-medium text-body text-fg-2 transition-colors duration-(--t-state) ease-land",
							"focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2",
							"disabled:cursor-not-allowed disabled:opacity-45",
							on ? "bg-surface text-fg shadow-ctl" : "can-hover:hover:text-fg",
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
						{o.label}
					</button>
				);
			})}
		</div>
	);
}
