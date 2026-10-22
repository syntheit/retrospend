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
	value: IsoDate;
	/** Today in the user's time zone (ISO). */
	today: IsoDate;
	onChange: (iso: IsoDate) => void;
};

/**
 * DatePicker: presets first (Today, Yesterday), then any day from a month
 * calendar or typed. The calendar opens in a popover on desktop and a
 * medium sheet on phones (nested when the picker sits in a sheet).
 */
export function DatePicker({ value, today, onChange }: DatePickerProps) {
	const t = useTranslations("pickers.date");
	const f = useDateFormat();
	const phone = useIsMobile();
	const [open, setOpen] = React.useState(false);
	const choice = choiceOf(value, today);

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
				{ value: "today", label: t("today") },
				{ value: "yesterday", label: t("yesterday") },
				{
					value: "other",
					label: choice === "other" ? f.label.long(value) : t("pick"),
				},
			]}
			value={choice}
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
				className="w-auto rounded-panel bg-surface p-4 shadow-menu"
			>
				{calendar}
			</PopoverContent>
		</Popover>
	);
}

/** One month and a typed field; arrows page through months as focus moves. */
function DayCalendar(p: {
	value: IsoDate;
	today: IsoDate;
	onPick: (iso: IsoDate) => void;
}) {
	const t = useTranslations("pickers.date");
	const f = useDateFormat();
	const [focusDay, setFocusDay] = React.useState(p.value);
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
				display={f.field}
				id={id}
				label={t("typed")}
				order={f.order}
				onChange={(iso) => iso && p.onPick(iso)}
				placeholder={t("placeholder")}
				value={p.value}
			/>
			<div className="flex items-center justify-between">
				<Button
					aria-label={t("earlier")}
					onClick={() => page("PageUp")}
					icon
					kind="ghost"
					size="sm"
				>
					<ChevronLeftIcon />
				</Button>
				<Button
					aria-label={t("later")}
					onClick={() => page("PageDown")}
					icon
					kind="ghost"
					size="sm"
				>
					<ChevronRightIcon />
				</Button>
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
				weekStart={f.weekStart}
				weekdays={f.weekdays}
			/>
		</div>
	);
}
