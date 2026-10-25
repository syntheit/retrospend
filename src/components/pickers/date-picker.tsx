"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { Button } from "~/components/ui/button";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "~/components/ui/popover";
import { Segmented } from "~/components/ui/segmented";
import { Sheet } from "~/components/ui/sheet";
import { Tip } from "~/components/ui/tooltip";
import { useIsMobile } from "~/hooks/use-mobile";
import { DateField } from "./date-field";
import { addDays, firstOfMonth, type IsoDate, moveDay } from "./dates";
import { MonthGrid, useDayFocus } from "./month-grid";
import { useDateFormat } from "./use-date-format";

type Choice = "today" | "yesterday" | "other";

export function choiceOf(value: IsoDate, today: IsoDate): Choice {
	if (value === today) return "today";
	if (value === addDays(today, -1)) return "yesterday";
	return "other";
}

export type DatePickerProps = {
	/** null: nothing is picked yet (only with `calendarOnly`). */
	value: IsoDate | null;
	/** Today in the user's time zone (ISO). */
	today: IsoDate;
	onChange: (iso: IsoDate) => void;
	/** Leaves out Today and Yesterday: one "Pick date" control that opens the calendar. */
	calendarOnly?: boolean;
};

/**
 * DatePicker: presets first (Today, Yesterday), then any day from a month
 * calendar or typed. The calendar opens in a popover on desktop and a
 * medium sheet on phones (nested when the picker sits in a sheet).
 */
export function DatePicker({
	value,
	today,
	onChange,
	calendarOnly = false,
}: DatePickerProps) {
	const t = useTranslations("pickers.date");
	const f = useDateFormat();
	const phone = useIsMobile();
	const [open, setOpen] = React.useState(false);
	const choice: Choice | "" = value
		? calendarOnly
			? "other"
			: choiceOf(value, today)
		: "";

	const pick = (iso: IsoDate) => {
		onChange(iso);
		setOpen(false);
	};

	const control = (
		<Segmented<Choice>
			label={t("title")}
			onChange={(c) => {
				if (c === "today") onChange(today);
				else if (c === "yesterday") onChange(addDays(today, -1));
				else setOpen(true);
			}}
			options={[
				...(calendarOnly
					? []
					: [
							{ value: "today" as const, label: t("today") },
							{ value: "yesterday" as const, label: t("yesterday") },
						]),
				{
					value: "other",
					label: value && choice === "other" ? f.label.long(value) : t("pick"),
				},
			]}
			// Nothing picked: "" matches no segment.
			value={choice as Choice}
		/>
	);

	const calendar = <DayCalendar onPick={pick} today={today} value={value} />;

	if (phone)
		return (
			<>
				{control}
				<Sheet
					detent="medium"
					footer={false}
					onOpenChange={setOpen}
					open={open}
					title={t("title")}
				>
					{calendar}
				</Sheet>
			</>
		);

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverAnchor asChild>
				<div className="inline-flex">{control}</div>
			</PopoverAnchor>
			<PopoverContent
				align="start"
				aria-label={t("title")}
				className="rounded-panel bg-surface shadow-menu w-auto p-4"
			>
				{calendar}
			</PopoverContent>
		</Popover>
	);
}

/** One month and a typed field; arrows page through months as focus moves. */
function DayCalendar(p: {
	value: IsoDate | null;
	today: IsoDate;
	onPick: (iso: IsoDate) => void;
}) {
	const t = useTranslations("pickers.date");
	const f = useDateFormat();
	const [focusDay, setFocusDay] = React.useState(p.value ?? p.today);
	const focus = useDayFocus(focusDay);
	const month = firstOfMonth(focusDay);
	const id = React.useId();
	const page = (key: "PageUp" | "PageDown") => {
		const next = moveDay(focusDay, { key }, f.weekStart);
		if (next) setFocusDay(next);
	};
	return (
		<div className="flex flex-col gap-3" ref={focus.container}>
			<DateField
				display={f.medium}
				edit={f.field}
				id={id}
				label={t("typed")}
				onChange={(iso) => iso && p.onPick(iso)}
				placeholder={t("placeholder")}
				read={f.read}
				value={p.value}
			/>
			<div className="flex items-center justify-between">
				<Tip content={t("earlier")}>
					<Button
						aria-label={t("earlier")}
						icon
						kind="ghost"
						onClick={() => page("PageUp")}
						size="sm"
					>
						<ChevronLeftIcon />
					</Button>
				</Tip>
				<Tip content={t("later")}>
					<Button
						aria-label={t("later")}
						icon
						kind="ghost"
						onClick={() => page("PageDown")}
						size="sm"
					>
						<ChevronRightIcon />
					</Button>
				</Tip>
			</div>
			<MonthGrid
				dayName={f.dayName}
				focusDay={focusDay}
				hi={p.value}
				lo={p.value}
				month={month}
				onFocusDay={setFocusDay}
				onMove={(d) => {
					focus.markMove();
					setFocusDay(d);
				}}
				onPick={p.onPick}
				title={f.monthTitle(month)}
				today={p.today}
				weekdays={f.weekdays}
				weekStart={f.weekStart}
			/>
		</div>
	);
}
