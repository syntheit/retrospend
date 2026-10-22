"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Money } from "~/components/money/money";
import { Button } from "~/components/ui/button";
import { StatusDot } from "~/components/ui/status-dot";
import { cn } from "~/lib/cn";
import { useRowDates } from "./dates";
import {
	CategoryTile,
	Row,
	type RowPassThrough,
	RowSub,
	useRowVariant,
} from "./row";
import type { RecurringVM } from "./types";

/** The amount: money in reads positive with a plus; a foreign one pairs. */
function RecurringAmount({ item }: { item: RecurringVM }) {
	const tone = item.direction === "in" ? "text-positive" : undefined;
	const sign = item.direction === "in" ? "exceptZero" : "auto";
	if (item.home !== undefined && item.home?.currency !== item.amount.currency)
		return (
			<Money.pair
				className={tone}
				home={item.home}
				original={item.amount}
				sign={sign}
			/>
		);
	return <Money className={tone} sign={sign} value={item.amount} />;
}

/**
 * Recurring row: next date, status in words, and on desktop Confirm and Skip
 * when it is due or overdue. Phone keeps those in the menu and swipes, so the
 * row stays one tap target (R13).
 */
export function RecurringRow({
	item,
	onConfirm,
	onSkip,
	onOpen,
	actions,
	...rest
}: {
	item: RecurringVM;
	onConfirm?: () => void;
	onSkip?: () => void;
	onOpen?: () => void;
	actions?: ReactNode;
} & RowPassThrough) {
	const t = useTranslations("rows.recurring");
	const { short } = useRowDates();
	const variant = useRowVariant();
	const wide =
		variant === "flat" ? "" : variant === "group" ? "hidden" : "max-md:hidden";
	const narrow =
		variant === "flat" ? "hidden" : variant === "group" ? "" : "md:hidden";
	const when =
		item.state === "overdue" ? (
			<>
				<StatusDot
					className={wide}
					kind="overdue"
					label={t("overdueSince", { date: short(item.next) })}
					size="sm"
				/>
				<StatusDot className={narrow} kind="overdue" size="sm" />
			</>
		) : item.state === "due" ? (
			<StatusDot kind="due" size="sm" />
		) : (
			t("next", { date: short(item.next) })
		);
	const due = item.state !== "upcoming" && (onConfirm || onSkip);
	return (
		<Row
			{...rest}
			actions={actions}
			end={
				<div className="flex items-center gap-4">
					<span className="flex flex-col items-end">
						<RecurringAmount item={item} />
					</span>
					{due && (
						<div className={cn("flex items-center gap-2", wide)}>
							{onConfirm && (
								<Button kind="secondary" onClick={onConfirm} size="sm">
									{t("confirm")}
								</Button>
							)}
							{onSkip && (
								<Button kind="ghost" onClick={onSkip} size="sm">
									{t("skip")}
								</Button>
							)}
						</div>
					)}
				</div>
			}
			lead={<CategoryTile category={item.category} />}
			open={onOpen ? { onOpen, label: item.title } : undefined}
			sub={<RowSub parts={[t(item.frequency), when]} />}
			title={item.title}
		/>
	);
}
