"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { Button } from "~/components/ui/button";
import { Chip } from "~/components/ui/chip";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";
import { DateField } from "./date-field";
import {
	completeRange,
	type DateRangeValue,
	drawnRange,
	initialLeft,
	jumpMonths,
	leftToShow,
	pickDay,
	presetOf,
	presets,
	previousPeriod,
	rangeLabel,
	visibleMonths,
} from "./date-range-model";
import { addMonths, type IsoDate } from "./dates";
import { MonthGrid, useDayFocus } from "./month-grid";
import { useDateFormat } from "./use-date-format";

export type DateRangeResult = DateRangeValue & { compare: boolean };

export type DateRangePanelProps = {
	value: DateRangeValue;
	compare: boolean;
	today: IsoDate;
	/** Phone: presets as chips, three months stacked; the Sheet owns Apply. */
	phone?: boolean;
	/** Desktop footer (the phone uses the Sheet's own footer). */
	onApply?: (r: DateRangeResult) => void;
	onCancel?: () => void;
	/** Phone: the parent's Apply reads the draft through this. */
	onDraft?: (r: DateRangeResult) => void;
};

/**
 * The DateRange body: presets first, typed From and To, a two-month
 * calendar (click start, click end, hover previews), a month jump and
 * Compare to previous period (off by default).
 */
export function DateRangePanel(p: DateRangePanelProps) {
	const t = useTranslations("pickers.dateRange");
	const f = useDateFormat();
	const count = p.phone ? 3 : 2;
	const [range, setRange] = React.useState(p.value);
	const [compare, setCompare] = React.useState(p.compare);
	const [hover, setHover] = React.useState<IsoDate | null>(null);
	const [left, setLeft] = React.useState(() =>
		initialLeft(p.value, p.today, count),
	);
	const [focusDay, setFocusDay] = React.useState(p.value.to ?? p.today);
	const focus = useDayFocus(focusDay);
	const months = visibleMonths(left, count);
	// Paging can move the focused day off screen; the first visible day keeps the tab stop.
	const tabDay = months.some((m) => focusDay.startsWith(m.slice(0, 7)))
		? focusDay
		: (months[0] ?? focusDay);
	const drawn = drawnRange(range, hover);
	const prev = compare ? previousPeriod(completeRange(range)) : null;
	const id = React.useId();

	const { onDraft } = p;
	React.useEffect(() => {
		onDraft?.({ ...completeRange(range), compare });
	}, [onDraft, range, compare]);

	const show = (day: IsoDate) => {
		setLeft((l) => leftToShow(day, l, count));
		setFocusDay(day);
	};
	const setEnd = (end: "from" | "to") => (iso: IsoDate | null) => {
		setRange((r) => ({ ...r, [end]: iso }));
		if (iso) show(iso);
	};
	const active = presetOf(range, p.today);
	const choose = (pr: DateRangeValue) => {
		setRange(pr);
		if (pr.to) show(pr.to);
	};

	const presetList = presets(p.today).map((pr) =>
		p.phone ? (
			<Chip active={pr.id === active} key={pr.id} onClick={() => choose(pr)}>
				{t(`preset.${pr.id}`)}
			</Chip>
		) : (
			<Button
				aria-pressed={pr.id === active}
				className={cn(
					"justify-start font-normal",
					pr.id === active && "bg-brand-soft",
				)}
				key={pr.id}
				onClick={() => choose(pr)}
				size="sm"
				type="button"
				variant="ghost"
			>
				{t(`preset.${pr.id}`)}
			</Button>
		),
	);

	const fields = (
		<div className="flex items-end gap-2">
			<DateField
				display={f.field}
				id={`${id}-from`}
				label={t("from")}
				locale={f.locale}
				onChange={setEnd("from")}
				placeholder={t("startDate")}
				value={range.from}
			/>
			<DateField
				display={f.field}
				id={`${id}-to`}
				label={t("to")}
				locale={f.locale}
				onChange={setEnd("to")}
				placeholder={t("endDate")}
				value={range.to}
			/>
		</div>
	);

	const compareRow = (
		<div className="flex items-center gap-2">
			<Switch
				aria-labelledby={`${id}-cmp`}
				checked={compare}
				onCheckedChange={setCompare}
			/>
			<span className="flex flex-col text-body" id={`${id}-cmp`}>
				{t("compare")}
				{prev ? (
					<span className="text-fg-3 text-meta">
						{rangeLabel(prev, p.today, f.label)}
					</span>
				) : null}
			</span>
		</div>
	);

	const jump = (
		<Select
			onValueChange={(m) => setLeft(addMonths(m, -(count - 1)))}
			value={months[count - 1]}
		>
			<SelectTrigger aria-label={t("jump")} className="h-ctl-sm">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{jumpMonths(p.today).map((m) => (
					<SelectItem key={m} value={m}>
						{f.monthTitle(m)}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);

	const grids = (
		<div
			className={cn("flex gap-6", p.phone && "flex-col")}
			ref={focus.container}
		>
			{months.map((m) => (
				<MonthGrid
					dayName={f.dayName}
					focusDay={tabDay}
					hi={drawn.hi}
					key={m}
					lo={drawn.lo}
					month={m}
					onFocusDay={setFocusDay}
					onHover={range.from && !range.to ? setHover : undefined}
					onMove={(d) => {
						focus.markMove();
						show(d);
					}}
					onPick={(d) => {
						setRange((r) => pickDay(r, d));
						setHover(null);
						setFocusDay(d);
					}}
					preview={drawn.preview}
					title={f.monthTitle(m)}
					today={p.today}
					weekStart={f.weekStart}
					weekdays={f.weekdays}
				/>
			))}
		</div>
	);

	if (p.phone)
		return (
			<div className="flex flex-col gap-4">
				<div className="-mx-4 flex gap-2 overflow-x-auto px-4">
					{presetList}
				</div>
				{fields}
				{compareRow}
				{jump}
				{grids}
			</div>
		);

	return (
		<div className="flex gap-4">
			<div
				aria-label={t("presets")}
				className="flex w-32 flex-col gap-1 border-line border-r pr-3"
				role="group"
			>
				{presetList}
			</div>
			<div className="flex flex-col gap-3">
				{fields}
				<div className="flex items-center gap-2">
					<Button
						aria-label={t("earlier")}
						onClick={() => setLeft((l) => addMonths(l, -1))}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<ChevronLeftIcon />
					</Button>
					{jump}
					<span className="flex-1" />
					<Button
						aria-label={t("later")}
						onClick={() => setLeft((l) => addMonths(l, 1))}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<ChevronRightIcon />
					</Button>
				</div>
				{grids}
				<div className="flex items-center gap-2 border-line border-t pt-3">
					{compareRow}
					<span className="flex-1" />
					<Button
						onClick={p.onCancel}
						size="sm"
						type="button"
						variant="outline"
					>
						{t("cancel")}
					</Button>
					<Button
						onClick={() => p.onApply?.({ ...completeRange(range), compare })}
						size="sm"
						type="button"
					>
						{t("apply")}
					</Button>
				</div>
			</div>
		</div>
	);
}
