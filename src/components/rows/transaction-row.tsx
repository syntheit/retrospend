"use client";

import {
	ArrowRightLeft,
	Banknote,
	CircleEllipsis,
	type LucideIcon,
	Scale,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback } from "react";
import { Money } from "~/components/money/money";
import { FaceStack } from "~/components/ui/avatar-face";
import { CategoryTile } from "~/components/ui/category-badge";
import { StatusDot } from "~/components/ui/status-dot";
import { cn } from "~/lib/cn";
import { useRowDates } from "./dates";
import {
	IconTile,
	Row,
	type RowPassThrough,
	RowSub,
	useRowVariant,
} from "./row";
import type { TransactionKind, TransactionVM } from "./types";

/** Money moves: never spending, so a neutral tile and a muted amount (§6). */
const MOVE_ICON: Partial<Record<TransactionKind, LucideIcon>> = {
	payment: Banknote,
	balance: Scale,
	transfer: ArrowRightLeft,
	exchange: ArrowRightLeft,
};

export function isMoneyMove(kind: TransactionKind) {
	return kind in MOVE_ICON;
}

/** The row lead: the category tile, or a neutral tile for a money move. */
export function TransactionLead({
	tx,
	size,
}: {
	tx: TransactionVM;
	size?: "default" | "sm";
}) {
	const move = MOVE_ICON[tx.kind];
	if (move || !tx.category) return <IconTile icon={move ?? CircleEllipsis} />;
	return <CategoryTile category={tx.category} size={size} />;
}

/** The kind word a non-expense row carries ("Payment · Pending", "Refund"). */
export function useKindWord() {
	const t = useTranslations("rows.kind");
	return useCallback(
		(tx: TransactionVM): string | null => {
			if (tx.kind === "expense") return null;
			if (tx.kind === "payment" && tx.pending) return t("paymentPending");
			return t(tx.kind);
		},
		[t],
	);
}

/**
 * The money column: the amount as entered, then one muted line. That line is
 * the other side of an exchange, your share of a split, or the home amount
 * of a foreign expense. Money in and refunds read positive with a plus.
 */
export function TransactionAmount({ tx }: { tx: TransactionVM }) {
	const t = useTranslations("rows.transaction");
	const move = isMoneyMove(tx.kind);
	const signed = tx.kind === "income" || tx.kind === "refund";
	const tone = signed ? "text-positive" : move ? "text-fg-3" : "text-fg";
	const muted = "text-fg-3 text-meta";
	const top = (
		<Money
			className={tone}
			figure={tx.figure}
			sign={signed ? "exceptZero" : "auto"}
			value={tx.amount}
		/>
	);
	if (tx.counter)
		return (
			<span className="flex flex-col items-end">
				{top}
				<Money className={muted} value={tx.counter} />
			</span>
		);
	if (tx.share && (tx.people?.length ?? 0) > 1 && !move)
		return (
			<span className="flex flex-col items-end">
				{top}
				<span className={cn("whitespace-nowrap", muted)}>
					{t("yourShare")} <Money figure={tx.shareFigure} value={tx.share} />
				</span>
			</span>
		);
	if (tx.home !== undefined && tx.home?.currency !== tx.amount.currency)
		return (
			<Money.pair
				className={tone}
				figure={tx.figure}
				home={tx.home}
				original={tx.amount}
				tip={tx.rateTip}
			/>
		);
	return top;
}

/** Who was in it: faces with the payer first, and "Martín paid". */
export function TransactionWith({ tx }: { tx: TransactionVM }) {
	const t = useTranslations("rows.transaction");
	const variant = useRowVariant();
	if ((tx.people?.length ?? 0) < 2) return null;
	return (
		<span className="inline-flex items-center gap-2">
			<FaceStack
				on={variant === "group" ? "surface" : "bg"}
				payerId={tx.payerId}
				people={tx.people ?? []}
			/>
			{tx.payerName && (
				<span className="text-fg-2">{t("paid", { name: tx.payerName })}</span>
			)}
		</span>
	);
}

/** Whether a row carries a status word (TransactionStatus renders something). */
export function hasStatus(tx: TransactionVM): boolean {
	return !tx.reviewed || tx.waiting != null;
}

/** The status words a row can carry: not reviewed, waiting on you, rejected. */
export function TransactionStatus({ tx }: { tx: TransactionVM }) {
	const t = useTranslations("rows.transaction");
	return (
		<>
			{!tx.reviewed && <StatusDot kind="review" size="sm" />}
			{tx.waiting === "review" && (
				<StatusDot kind="review" label={t("waiting")} size="sm" />
			)}
			{tx.waiting === "rejected" && <StatusDot kind="rejected" size="sm" />}
		</>
	);
}

/**
 * TransactionRow (§6): one expense, payment or transfer on a phone list or a
 * desktop list. Desktop Activity uses TransactionTable, built from the same
 * pieces. The server sends the amounts, the share and the home value (R9).
 */
export function TransactionRow({
	tx,
	showDate = false,
	hideProject = false,
	today,
	onOpen,
	actions,
	...rest
}: {
	tx: TransactionVM;
	/** Add the day to the subline (lists not grouped by day). */
	showDate?: boolean;
	/** Inside a project page the project would repeat on every row. */
	hideProject?: boolean;
	/** ISO date of today, for "Today" and "Yesterday". */
	today?: string;
	onOpen?: () => void;
	actions?: ReactNode;
} & RowPassThrough) {
	const t = useTranslations("rows.transaction");
	const kindWord = useKindWord()(tx);
	const dates = useRowDates(today);
	const split = (tx.people?.length ?? 0) > 1;
	const category =
		tx.category?.name ?? (isMoneyMove(tx.kind) ? null : t("other"));
	const who = split
		? { keep: <TransactionWith tx={tx} /> }
		: !hideProject && tx.project
			? tx.project.name
			: null;
	return (
		<Row
			{...rest}
			actions={actions}
			data-row-kind={tx.kind}
			end={<TransactionAmount tx={tx} />}
			lead={<TransactionLead tx={tx} />}
			open={onOpen ? { onOpen, label: tx.title } : undefined}
			sub={
				<RowSub
					parts={[
						hasStatus(tx) && <TransactionStatus tx={tx} />,
						kindWord,
						category && { shrink: category },
						who,
						showDate && dates.day(tx.date),
					]}
				/>
			}
			title={tx.title}
		/>
	);
}
