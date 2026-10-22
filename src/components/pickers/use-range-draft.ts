"use client";

import * as React from "react";

import {
	completeRange,
	type DateRangeValue,
	drawnRange,
	initialLeft,
	leftToShow,
	pickDay,
	presetOf,
	previousPeriod,
	visibleMonths,
} from "./date-range-model";
import { addMonths, type IsoDate } from "./dates";
import { useDayFocus } from "./month-grid";

export type DateRangeResult = DateRangeValue & { compare: boolean };

/**
 * The DateRange draft: the range being picked, Compare, the hover preview,
 * the months on screen and the roving day. Nothing applies until Apply.
 */
export function useRangeDraft(p: {
	value: DateRangeValue;
	compare: boolean;
	today: IsoDate;
	count: number;
	onDraft?: (r: DateRangeResult) => void;
}) {
	const { count, today, onDraft } = p;
	const [range, setRange] = React.useState(p.value);
	const [compare, setCompare] = React.useState(p.compare);
	const [hover, setHover] = React.useState<IsoDate | null>(null);
	const [left, setLeft] = React.useState(() =>
		initialLeft(p.value, today, count),
	);
	const [focusDay, setFocusDay] = React.useState(p.value.to ?? today);
	const focus = useDayFocus(focusDay);
	const months = visibleMonths(left, count);
	const result: DateRangeResult = { ...completeRange(range), compare };

	React.useEffect(() => {
		onDraft?.({ ...completeRange(range), compare });
	}, [onDraft, range, compare]);

	const show = (day: IsoDate) => {
		setLeft((l) => leftToShow(day, l, count));
		setFocusDay(day);
	};

	return {
		range,
		compare,
		setCompare,
		result,
		months,
		// Paging can move the focused day off screen; the first visible day keeps the tab stop.
		tabDay: months.some((m) => focusDay.startsWith(m.slice(0, 7)))
			? focusDay
			: (months[0] ?? focusDay),
		drawn: drawnRange(range, hover),
		previous: compare ? previousPeriod(completeRange(range)) : null,
		active: presetOf(range, today),
		focusContainer: focus.container,
		hovering: range.from && !range.to ? setHover : undefined,
		page: (n: number) => setLeft((l) => addMonths(l, n)),
		jumpTo: (lastMonth: IsoDate) => setLeft(addMonths(lastMonth, -(count - 1))),
		choose: (r: DateRangeValue) => {
			setRange(r);
			if (r.to) show(r.to);
		},
		setEnd: (end: "from" | "to", iso: IsoDate | null) => {
			setRange((r) => ({ ...r, [end]: iso }));
			if (iso) show(iso);
		},
		focusOn: setFocusDay,
		move: (day: IsoDate) => {
			focus.markMove();
			show(day);
		},
		pick: (day: IsoDate) => {
			setRange((r) => pickDay(r, day));
			setHover(null);
			setFocusDay(day);
		},
	};
}

export type RangeDraft = ReturnType<typeof useRangeDraft>;
