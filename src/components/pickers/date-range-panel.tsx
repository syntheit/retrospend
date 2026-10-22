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
	type DateRangeValue,
	jumpMonths,
	presets,
	rangeLabel,
} from "./date-range-model";
import type { IsoDate } from "./dates";
import { MonthGrid } from "./month-grid";
import {
	type DateRangeResult,
	type RangeDraft,
	useRangeDraft,
} from "./use-range-draft";
import { useDateFormat } from "./use-date-format";

export type { DateRangeResult };

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

type Part = { d: RangeDraft; today: IsoDate; phone?: boolean };

/**
 * The DateRange body: presets first, typed From and To, a two-month
 * calendar (click start, click end, hover previews), a month jump and
 * Compare to previous period (off by default).
 */
export function DateRangePanel(p: DateRangePanelProps) {
	const t = useTranslations("pickers.dateRange");
	const d = useRangeDraft({ ...p, count: p.phone ? 3 : 2 });
	const part = { d, today: p.today, phone: p.phone };
	if (p.phone)
		return (
			<div className="flex flex-col gap-4">
				<div className="-mx-4 flex gap-2 overflow-x-auto px-4">
					<Presets {...part} />
				</div>
				<RangeFields {...part} />
				<CompareRow {...part} />
				<MonthJump {...part} />
				<Calendars {...part} />
			</div>
		);
	return (
		<div className="flex gap-4">
			<div
				aria-label={t("presets")}
				className="flex w-32 flex-col gap-1 border-line border-r pr-3"
				role="group"
			>
				<Presets {...part} />
			</div>
			<div className="flex flex-col gap-3">
				<RangeFields {...part} />
				<div className="flex items-center gap-2">
					<Button
						aria-label={t("earlier")}
						onClick={() => d.page(-1)}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<ChevronLeftIcon />
					</Button>
					<MonthJump {...part} />
					<span className="flex-1" />
					<Button
						aria-label={t("later")}
						onClick={() => d.page(1)}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<ChevronRightIcon />
					</Button>
				</div>
				<Calendars {...part} />
				<div className="flex items-center gap-2 border-line border-t pt-3">
					<CompareRow {...part} />
					<span className="flex-1" />
					<Button
						onClick={p.onCancel}
						size="sm"
						type="button"
						variant="outline"
					>
						{t("cancel")}
					</Button>
					<Button onClick={() => p.onApply?.(d.result)} size="sm" type="button">
						{t("apply")}
					</Button>
				</div>
			</div>
		</div>
	);
}

function Presets({ d, today, phone }: Part) {
	const t = useTranslations("pickers.dateRange");
	return presets(today).map((pr) =>
		phone ? (
			<Chip
				active={pr.id === d.active}
				key={pr.id}
				onClick={() => d.choose(pr)}
			>
				{t(`preset.${pr.id}`)}
			</Chip>
		) : (
			<Button
				aria-pressed={pr.id === d.active}
				className={cn(
					"justify-start font-normal",
					pr.id === d.active && "bg-brand-soft",
				)}
				key={pr.id}
				onClick={() => d.choose(pr)}
				size="sm"
				type="button"
				variant="ghost"
			>
				{t(`preset.${pr.id}`)}
			</Button>
		),
	);
}

function RangeFields({ d }: Part) {
	const t = useTranslations("pickers.dateRange");
	const f = useDateFormat();
	const id = React.useId();
	return (
		<div className="flex items-end gap-2">
			{(["from", "to"] as const).map((end) => (
				<DateField
					display={f.field}
					id={`${id}-${end}`}
					key={end}
					label={t(end)}
					onChange={(iso) => d.setEnd(end, iso)}
					order={f.order}
					placeholder={t(end === "from" ? "startDate" : "endDate")}
					value={d.range[end]}
				/>
			))}
		</div>
	);
}

function CompareRow({ d, today }: Part) {
	const t = useTranslations("pickers.dateRange");
	const f = useDateFormat();
	const id = React.useId();
	return (
		<div className="flex items-center gap-2">
			<Switch
				aria-labelledby={id}
				checked={d.compare}
				onCheckedChange={d.setCompare}
			/>
			<span className="flex flex-col text-body" id={id}>
				{t("compare")}
				{d.previous ? (
					<span className="text-fg-3 text-meta">
						{rangeLabel(d.previous, today, f.label)}
					</span>
				) : null}
			</span>
		</div>
	);
}

function MonthJump({ d, today }: Part) {
	const t = useTranslations("pickers.dateRange");
	const f = useDateFormat();
	return (
		<Select onValueChange={d.jumpTo} value={d.months.at(-1)}>
			<SelectTrigger aria-label={t("jump")} className="h-ctl-sm">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{jumpMonths(today).map((m) => (
					<SelectItem key={m} value={m}>
						{f.monthTitle(m)}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function Calendars({ d, today, phone }: Part) {
	const f = useDateFormat();
	return (
		<div
			className={cn("flex gap-6", phone && "flex-col")}
			ref={d.focusContainer}
		>
			{d.months.map((m) => (
				<MonthGrid
					dayName={f.dayName}
					focusDay={d.tabDay}
					hi={d.drawn.hi}
					key={m}
					lo={d.drawn.lo}
					month={m}
					onFocusDay={d.focusOn}
					onHover={d.hovering}
					onMove={d.move}
					onPick={d.pick}
					preview={d.drawn.preview}
					title={f.monthTitle(m)}
					today={today}
					weekStart={f.weekStart}
					weekdays={f.weekdays}
				/>
			))}
		</div>
	);
}
