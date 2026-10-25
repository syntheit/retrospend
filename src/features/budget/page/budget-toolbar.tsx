"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Toolbar } from "~/components/layout/toolbar";
import { useRowDates } from "~/components/rows/dates";
import { Button } from "~/components/ui/button";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/cn";
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import { MonthSwitch } from "./month-switch";
import { monthStartIso, shiftMonth } from "./months";
import { type Chip, countStatus } from "./view-model";

/**
 * One row under the header (R1): the month, search, the status chips, and
 * Plan next month at the end. Search and chips narrow the list only; they
 * never change a number.
 */
export function BudgetToolbar({
	data,
	months,
	current,
	limits,
	planning,
	query,
	chip,
	onQuery,
	onChip,
	onMonth,
}: {
	data: GetMonthOutput;
	months: number[];
	current: number;
	limits: boolean;
	/** Plan next month has its own list: no search or chips there. */
	planning: boolean;
	query: string;
	chip: Chip | null;
	onQuery: (q: string) => void;
	onChip: (c: Chip | null) => void;
	onMonth: (key: number) => void;
}) {
	const t = useTranslations("budgetPage.toolbar");
	const { month } = useRowDates();
	const key = data.month.key;
	const over = countStatus(data.groups, "overspent");
	const under = countStatus(data.groups, "underfunded");
	const toggle = (c: Chip) => onChip(chip === c ? null : c);
	const next = shiftMonth(current, 1);
	// A phone keeps the month and the hero; search and chips come with a long list (SPEC §6.2).
	const long = data.groups.reduce((n, g) => n + g.envelopes.length, 0) > 8;
	return (
		<Toolbar
			end={
				key === current ? (
					<Button
						className="max-md:hidden"
						kind="secondary"
						onClick={() => onMonth(next)}
					>
						{t("plan", { month: month(monthStartIso(next)) })}
					</Button>
				) : undefined
			}
			label={t("label")}
			search={
				<>
					<MonthSwitch
						current={current}
						months={months}
						onChange={onMonth}
						value={key}
					/>
					<div
						className={cn(
							"relative max-md:w-full",
							planning ? "hidden" : !long && "max-md:hidden",
						)}
					>
						<Search
							aria-hidden="true"
							className="text-fg-3 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
						/>
						<Input
							aria-label={limits ? t("searchLimits") : t("search")}
							className="h-ctl w-64 pr-2 pl-8 max-md:w-full"
							onChange={(e) => onQuery(e.target.value)}
							placeholder={limits ? t("searchLimits") : t("search")}
							type="search"
							value={query}
						/>
					</div>
				</>
			}
		>
			<FilterChips
				className={cn(planning ? "hidden" : !long && "max-md:hidden")}
				label={t("chips")}
			>
				{over > 0 && (
					<FilterChip
						onClick={() => toggle("overspent")}
						selected={chip === "overspent"}
					>
						{t("overspent", { count: over })}
					</FilterChip>
				)}
				{under > 0 && (
					<FilterChip
						onClick={() => toggle("underfunded")}
						selected={chip === "underfunded"}
					>
						{t("underfunded", { count: under })}
					</FilterChip>
				)}
			</FilterChips>
		</Toolbar>
	);
}
