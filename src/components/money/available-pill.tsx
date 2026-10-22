"use client";

import { useStatusWord } from "~/components/ui/status-dot";
import { TONE, toneOf } from "~/components/ui/status-map";
import { cn } from "~/lib/cn";
import { type MoneyValue, signOf } from "./format";
import { Money } from "./money";

export type AvailableStatus = "funded" | "underfunded" | "overspent";

/**
 * AvailablePill (R5): an envelope's available money with its status word,
 * the one place money sits in a pill. Colors come from the status map:
 * funded is positive text on an edge, never a fill; underfunded and
 * overspent fill with attention. The server sends the amount and the
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
	const tone = toneOf(status);
	const zero = status === "funded" && signOf(amount) === 0;
	const look = zero
		? cn(TONE.quiet.edge, TONE.quiet.text)
		: cn(tone.edge, tone.text, status !== "funded" && tone.pill);
	return (
		<span
			className={cn(
				"inline-flex h-6 items-center gap-2 whitespace-nowrap rounded-chip border px-3 font-semibold text-small tabular-nums",
				look,
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
