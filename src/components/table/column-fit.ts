"use client";

import { type RefObject, useLayoutEffect, useState } from "react";

/** The least width the Title column keeps (min-w-48, 12rem). */
export const TITLE_MIN = 192;

/**
 * Which optional columns fit in `space` pixels beside `fixed` pixels of
 * columns that always show (and the Title's minimum). `optional` lists the
 * columns from the one that matters most to the one that goes first; a
 * column shows only when it and every column before it fit, so the lower
 * priorities drop first and Title never shrinks below its minimum.
 * `space` null (not measured yet) shows them all.
 */
export function fitColumns<Id extends string>(
	space: number | null,
	fixed: number,
	optional: readonly { id: Id; size: number }[],
): Set<Id> {
	const shown = new Set<Id>();
	let used = fixed + TITLE_MIN;
	for (const col of optional) {
		if (space !== null && used + col.size > space) break;
		used += col.size;
		shown.add(col.id);
	}
	return shown;
}

/** The width of an element, kept current as the window or sidebar changes. */
export function useElementWidth(ref: RefObject<HTMLElement | null>) {
	const [width, setWidth] = useState<number | null>(null);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => setWidth(Math.round(el.getBoundingClientRect().width));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [ref]);
	return width;
}
