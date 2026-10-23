"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Money } from "~/components/money/money";
import { Button } from "~/components/ui/button";
import { CategoryTile } from "~/components/ui/category-badge";
import { StatusDot } from "~/components/ui/status-dot";
import { cn } from "~/lib/cn";
import { useRowDates } from "./dates";
import { Row, type RowPassThrough, RowSub, useRowVariant } from "./row";
import type { RecurringVM } from "./types";

/** The amount: money in reads positive with a plus; a foreign one pairs. */
function RecurringAmount({ item }: { item: RecurringVM }) {
	const tone = item.direction === "in" ? "text-positive" : undefined;
	const sign = item.direction === "in" ? "exceptZero" : "auto";
	if (item.home !== undefined && item.home?.currency !== item.amount.currency)
		return (
			<Money.pair
				className={tone}
				figure={item.figure}
				home={item.home}
				original={item.amount}
				sign={sign}
			/>
		);
	return (
		<Money
			className={tone}
			figure={item.figure}
			sign={sign}
			value={item.amount}
		/>
	);
}

/**
 * Recurring row (recurring.html): the due state in words, then how often
 * (left out when monthly, the usual case), and the auto-pay line when the
 * view model has it. Desktop lists show Confirm and Skip when it is due or
 * overdue; phone keeps those in the menu and swipes, so the row stays one
 * tap target (R13). A paused template is muted and says so.
 */
export function RecurringRow({
	item,
	onConfirm,
	onSkip,
	onOpen,
	actions,
	className,
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
	const when = item.paused ? (
		t("paused")
	) : item.state === "overdue" ? (
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
	const due =
		!item.paused && item.state !== "upcoming" && (onConfirm || onSkip);
	return (
		<Row
			{...rest}
			actions={actions}
			className={cn(item.paused && "text-fg-3", className)}
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
			sub={
				<>
					<RowSub
						parts={[when, item.frequency !== "monthly" && t(item.frequency)]}
					/>
					{item.autoPay !== undefined && (
						<RowSub parts={[t(item.autoPay ? "autoPayOn" : "autoPayOff")]} />
					)}
				</>
			}
			title={item.title}
		/>
	);
}
