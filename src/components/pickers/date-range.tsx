"use client";

import { useTranslations } from "next-intl";
import * as React from "react";

import { FilterChip } from "~/components/ui/chip";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { Sheet } from "~/components/ui/sheet";
import { useIsMobile } from "~/hooks/use-mobile";
import { type DateRangeValue, rangeLabel } from "./date-range-model";
import { DateRangePanel, type DateRangeResult } from "./date-range-panel";
import type { IsoDate } from "./dates";
import { useDateFormat } from "./use-date-format";

export type { DateRangeResult, DateRangeValue };

export type DateRangeProps = {
	value: DateRangeValue;
	compare?: boolean;
	/** Today in the user's time zone (ISO). */
	today: IsoDate;
	onChange: (r: DateRangeResult) => void;
	className?: string;
};

/**
 * DateRange: the one date filter. A neutral value chip ("Oct 2026", "Last
 * 30 days", "Sep 22 to Oct 21") opens a popover on desktop and a large
 * sheet on phones.
 */
export function DateRange({
	value,
	compare = false,
	today,
	onChange,
	className,
}: DateRangeProps) {
	const t = useTranslations("pickers.dateRange");
	const f = useDateFormat();
	const phone = useIsMobile();
	const [open, setOpen] = React.useState(false);
	const draft = React.useRef<DateRangeResult>({ ...value, compare });
	const label = rangeLabel(value, today, f.label);
	const onDraft = React.useCallback((r: DateRangeResult) => {
		draft.current = r;
	}, []);

	const trigger = (
		<FilterChip
			aria-haspopup="dialog"
			aria-label={t("trigger", { range: label })}
			className={className}
			onClick={phone ? () => setOpen(true) : undefined}
			value
		>
			{label}
		</FilterChip>
	);

	const apply = (r: DateRangeResult) => {
		onChange(r);
		setOpen(false);
	};

	if (phone)
		return (
			<>
				{trigger}
				<Sheet
					detent="large"
					onOpenChange={setOpen}
					onSubmit={() => onChange(draft.current)}
					open={open}
					submitLabel={t("apply")}
					title={t("title")}
				>
					<DateRangePanel
						compare={compare}
						onDraft={onDraft}
						phone
						today={today}
						value={value}
					/>
				</Sheet>
			</>
		);

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PopoverContent
				align="start"
				aria-label={t("title")}
				className="w-auto rounded-panel bg-surface p-4 shadow-menu"
			>
				<DateRangePanel
					compare={compare}
					onApply={apply}
					onCancel={() => setOpen(false)}
					today={today}
					value={value}
				/>
			</PopoverContent>
		</Popover>
	);
}
