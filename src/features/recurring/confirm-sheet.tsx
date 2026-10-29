"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { DatePicker } from "~/components/pickers/date-picker";
import { useRowDates } from "~/components/rows/dates";
import { Button } from "~/components/ui/button";
import { Segmented } from "~/components/ui/segmented";
import { Sheet } from "~/components/ui/sheet";
import type { RecurringItemDTO } from "~/server/services/recurring-view.service";
import { RecurringMoney } from "./recurring-table";

type PaidOn = "due" | "today" | "pick";

/**
 * The Confirm step before a due recurring item is logged (R30): the day it
 * was paid (or received) is the due date, today when it is overdue, or a day
 * picked. It names the amount and the date it books, what moves (the next due
 * date) and what does not. Skip this time hands over to the skip step. A
 * template whose amount varies has no Confirm here (it needs an amount field).
 */
export function ConfirmSheet({
	item,
	today,
	onOpenChange,
	onConfirm,
	onSkip,
}: {
	item: RecurringItemDTO;
	today: string;
	onOpenChange: (open: boolean) => void;
	onConfirm: (paidOn: string) => Promise<void>;
	onSkip: () => void;
}) {
	const t = useTranslations("activityRecurring.confirmSheet");
	const { short } = useRowDates(today);
	const income = item.direction === "in";
	const overdue = item.next < today;
	const [mode, setMode] = useState<PaidOn>("due");
	const [picked, setPicked] = useState(today);
	const paidOn =
		mode === "today" ? today : mode === "pick" ? picked : item.next;
	const future = mode === "pick" && picked > today;
	const early = mode === "pick" && picked < item.paidOnFrom;
	const label = t(income ? "paidOnIn" : "paidOn");
	const row = "flex items-baseline justify-between gap-3 py-2";
	return (
		<Sheet
			description={t(income ? "descriptionIn" : "description", {
				date: short(paidOn),
			})}
			detent="medium"
			onOpenChange={onOpenChange}
			onSubmit={() => onConfirm(paidOn)}
			open
			submitDisabled={future || early}
			submitLabel={t(income ? "submitIn" : "submitOut")}
			title={t("title", { name: item.title })}
		>
			<div className="flex flex-col gap-2 pb-3">
				<p className="text-fg-2 text-small font-medium">{label}</p>
				<Segmented
					full
					label={label}
					onChange={setMode}
					options={[
						{
							value: "due",
							label: overdue
								? t("paidOnDue", { date: short(item.next) })
								: t("paidOnDueToday"),
						},
						...(overdue
							? [{ value: "today" as const, label: t("paidOnToday") }]
							: []),
						{ value: "pick", label: t("paidOnPick") },
					]}
					value={mode}
				/>
				{mode === "pick" ? (
					<DatePicker
						calendarOnly
						onChange={setPicked}
						today={today}
						value={picked}
					/>
				) : null}
				{future ? (
					<p className="text-danger text-small" role="alert">
						{t("future")}
					</p>
				) : null}
				{early ? (
					<p className="text-danger text-small" role="alert">
						{t("tooEarly", { date: short(item.paidOnFrom) })}
					</p>
				) : null}
			</div>
			<p className="text-fg-3 text-meta font-medium">{t("changes")}</p>
			<dl className="divide-line text-body divide-y">
				<div className={row} data-confirm="entry">
					<dt className="text-fg-2">
						{t(income ? "entryIn" : "entry", { date: short(paidOn) })}
					</dt>
					<dd className="text-right">
						<RecurringMoney r={item} />
					</dd>
				</div>
				<div className={row} data-confirm="next">
					<dt className="text-fg-2">{t("next")}</dt>
					<dd className="text-fg tabular-nums">
						{t("nextValue", {
							before: short(item.next),
							after: short(item.nextAfter),
						})}
					</dd>
				</div>
			</dl>
			<p className="text-fg-2 text-small mt-3">{t("unchanged")}</p>
			<div className="mt-3">
				<Button kind="ghost" onClick={onSkip}>
					{t("skip")}
				</Button>
			</div>
		</Sheet>
	);
}
