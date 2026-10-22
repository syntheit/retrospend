"use client";

import { useStatusWord } from "~/components/ui/status-dot";
import { cn } from "~/lib/cn";
import { type MoneyValue, signOf } from "./format";
import { Money } from "./money";

export type AvailableStatus = "funded" | "underfunded" | "overspent";

const LOOK: Record<AvailableStatus | "zero", string> = {
	funded: "border-positive/55 text-positive",
	underfunded: "border-attention/55 bg-attention-bg text-attention-text",
	overspent: "border-attention/55 bg-attention-bg text-attention-text",
	zero: "border-line-strong text-fg-2",
};

/**
 * AvailablePill (R5): an envelope's available money with its status word,
 * the one place money sits in a pill. The server sends the amount and the
 * status; the word says the sign, so an overspent amount shows no minus.
 * Funded at zero turns neutral.
 */
export function AvailablePill({
	amount,
	status,
	className,
}: {
	amount: MoneyValue;
	status: AvailableStatus;
	className?: string;
}) {
	const word = useStatusWord();
	const look = status === "funded" && signOf(amount) === 0 ? "zero" : status;
	return (
		<span
			className={cn(
				"inline-flex h-6 items-center gap-2 whitespace-nowrap rounded-chip border px-3 font-semibold text-small tabular-nums",
				LOOK[look],
				className,
			)}
			data-status={status}
		>
			<Money sign="never" value={amount} />
			<span aria-hidden="true">·</span>
			<span>{word(status)}</span>
		</span>
	);
}
