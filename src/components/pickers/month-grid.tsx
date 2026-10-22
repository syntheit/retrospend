"use client";

import * as React from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import {
	type IsoDate,
	monthCells,
	moveDay,
	type WeekStart,
	weekdayOrder,
} from "./dates";

export type MonthGridProps = {
	/** First day of the month shown. */
	month: IsoDate;
	today: IsoDate;
	/** The drawn ends; a single day has lo === hi. */
	lo: IsoDate | null;
	hi: IsoDate | null;
	/** The end is only a hover preview. */
	preview?: boolean;
	/** The one day in the tab order (roving focus); the parent keeps it on screen. */
	focusDay: IsoDate;
	onFocusDay: (day: IsoDate) => void;
	/** A grid key moved focus; the parent turns the page and focuses it (useDayFocus). */
	onMove: (day: IsoDate) => void;
	onPick: (day: IsoDate) => void;
	onHover?: (day: IsoDate | null) => void;
	weekStart: WeekStart;
	title: string;
	weekdays: string[];
	dayName: (day: IsoDate) => string;
};

/**
 * One month of days for DatePicker and DateRange. Arrows, Home, End,
 * PageUp and PageDown move focus (the parent turns the page when focus
 * leaves the month); Enter or Space picks.
 */
export function MonthGrid(p: MonthGridProps) {
	const cells = monthCells(p.month, p.weekStart);

	const onKeyDown = (e: React.KeyboardEvent) => {
		const next = moveDay(p.focusDay, e.nativeEvent, p.weekStart);
		if (!next) return;
		e.preventDefault();
		p.onMove(next);
	};

	return (
		<div className="w-64" onPointerLeave={() => p.onHover?.(null)}>
			<div className="mb-2 text-center font-medium text-fg text-small">
				{p.title}
			</div>
			<div
				aria-label={p.title}
				className="grid grid-cols-7"
				onKeyDown={onKeyDown}
				role="group"
			>
				{weekdayOrder(p.weekStart).map((d) => (
					<span
						aria-hidden="true"
						className="py-1 text-center text-fg-3 text-meta"
						key={d}
					>
						{p.weekdays[d]}
					</span>
				))}
				{cells.map((day, i) =>
					day ? (
						<DayCell
							day={day}
							key={day}
							label={p.dayName(day)}
							onFocus={() => p.onFocusDay(day)}
							onHover={p.onHover}
							onPick={p.onPick}
							state={dayState(day, p)}
							tabbable={day === p.focusDay}
						/>
					) : (
						<span aria-hidden="true" key={`lead-${i}`} />
					),
				)}
			</div>
		</div>
	);
}

type DayState = {
	end: boolean;
	inside: boolean;
	today: boolean;
	preview: boolean;
};

export function dayState(
	day: IsoDate,
	p: {
		lo: IsoDate | null;
		hi: IsoDate | null;
		today: IsoDate;
		preview?: boolean;
	},
): DayState {
	const end = day === p.lo || day === p.hi;
	const inside = !!(p.lo && p.hi && day > p.lo && day < p.hi);
	return {
		end,
		inside,
		today: day === p.today,
		preview: !!p.preview && (inside || day === p.hi),
	};
}

function DayCell(props: {
	day: IsoDate;
	label: string;
	state: DayState;
	tabbable: boolean;
	onPick: (day: IsoDate) => void;
	onFocus: () => void;
	onHover?: (day: IsoDate | null) => void;
}) {
	const { day, state } = props;
	return (
		<Button
			aria-label={props.label}
			aria-pressed={state.end}
			className={cn(
				"h-8 w-full rounded-ctl p-0 font-normal text-body tabular-nums",
				state.inside && "rounded-none bg-brand-soft",
				state.preview && "bg-raised",
				state.end && !state.preview && "bg-brand text-brand-fg hover:bg-brand",
				state.today && !state.end && "font-semibold text-accent-strong",
			)}
			data-day={day}
			onClick={() => props.onPick(day)}
			onFocus={props.onFocus}
			onPointerEnter={() => props.onHover?.(day)}
			kind="ghost"
			size="sm"
			tabIndex={props.tabbable ? 0 : -1}
		>
			{Number(day.slice(8))}
		</Button>
	);
}

/**
 * Roving focus across one or more MonthGrids: after a grid key moves the
 * focused day (and maybe the visible months), focus follows it once the
 * new day is rendered.
 */
export function useDayFocus(focusDay: IsoDate) {
	const container = React.useRef<HTMLDivElement>(null);
	const pending = React.useRef(false);
	React.useEffect(() => {
		if (!pending.current) return;
		pending.current = false;
		container.current
			?.querySelector<HTMLElement>(`[data-day="${focusDay}"]`)
			?.focus();
	}, [focusDay]);
	return {
		container,
		/** Call from onMove, before setting the new focus day. */
		markMove: () => {
			pending.current = true;
		},
	};
}
