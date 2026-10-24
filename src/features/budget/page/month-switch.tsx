"use client";

import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRowDates } from "~/components/rows/dates";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Tip } from "~/components/ui/tooltip";
import { monthStartIso, shiftMonth } from "./months";

/** "October 2026", from a month key. */
export function useMonthLabel() {
	const t = useTranslations("budgetPage.month");
	const { month } = useRowDates();
	return (key: number) =>
		t("label", {
			month: month(monthStartIso(key)),
			year: String(Math.floor(key / 100)),
		});
}

/**
 * The month stepper (R1): back opens the month before (read only once it has
 * closed), forward the one after. Under the title on a phone, first in the
 * toolbar on a wide screen. The label opens the list of months you can
 * look at. `months` runs from the month the budget started to the next one,
 * as the server allows (`getMonth` refuses any other).
 */
export function MonthSwitch({
	months,
	value,
	current,
	onChange,
}: {
	months: number[];
	value: number;
	/** The month today is in. */
	current: number;
	onChange: (key: number) => void;
}) {
	const t = useTranslations("budgetPage.month");
	const label = useMonthLabel();
	const first = months[0] ?? value;
	const last = months[months.length - 1] ?? value;
	const stateOf = (key: number) =>
		key < current ? "closed" : key > current ? "next" : "open";
	return (
		<div
			className="h-ctl border-line-strong bg-surface rounded-ctl inline-flex items-center border"
			data-slot="month-switch"
		>
			<Tip content={t("previous")}>
				<Button
					aria-label={t("previous")}
					disabled={value <= first}
					icon
					kind="ghost"
					onClick={() => onChange(shiftMonth(value, -1))}
				>
					<ChevronLeft aria-hidden="true" />
				</Button>
			</Tip>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						aria-label={t("pick")}
						className="text-fg font-medium"
						kind="ghost"
					>
						{label(value)}
						<ChevronDown aria-hidden="true" className="text-fg-3" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start">
					{[...months].reverse().map((key) => (
						<DropdownMenuItem key={key} onSelect={() => onChange(key)}>
							{key === value ? (
								<Check aria-hidden="true" />
							) : (
								<span className="size-4" />
							)}
							{stateOf(key) === "open"
								? label(key)
								: t(stateOf(key) === "closed" ? "closedItem" : "planItem", {
										month: label(key),
									})}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
			<Tip content={t("next")}>
				<Button
					aria-label={t("next")}
					disabled={value >= last}
					icon
					kind="ghost"
					onClick={() => onChange(shiftMonth(value, 1))}
				>
					<ChevronRight aria-hidden="true" />
				</Button>
			</Tip>
		</div>
	);
}
