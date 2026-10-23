"use client";

import { useTranslations } from "next-intl";
import { useStatusWord } from "~/components/ui/status-dot";
import { toneOf } from "~/components/ui/status-map";
import { cn } from "~/lib/cn";
import { figureAttrs, type MoneyValue, signOf } from "./format";
import { Money } from "./money";

/**
 * Who the balance is about: one person ("owes you", "you owe"), people in
 * general ("people owe you", "you owe people"), or you ("owed to you").
 */
export type BalanceSubject = "person" | "people" | "you";

const WORDS = {
	person: { owed: "owesYou", owe: "youOwe" },
	people: { owed: "peopleOweYou", owe: "youOwePeople" },
	you: { owed: "owedToYou", owe: "youOwe" },
} as const;

/**
 * Balance (R5, D1): an amount with its words, colored from the status map.
 * Positive means money coming to you (owed: positive plus "owes you");
 * negative is plain text with "you owe", because owing is not an alarm;
 * zero is the Settled status. The words carry the sign, so the amount shows
 * none. Owed to you and You owe are separate figures from the server, never
 * netted here.
 */
export function Balance({
	amount,
	subject = "person",
	figure,
	approx = false,
	words = true,
	className,
}: {
	amount: MoneyValue;
	/** A net converted across currencies: "≈" before the amount. */
	approx?: boolean;
	/**
	 * False inside a group whose heading already says it ("Owe you"): the
	 * amount keeps its color and drops the words (GUIDELINE §6).
	 */
	words?: boolean;
	/** The figures registry key, for the e2e audit. */
	figure?: string;
	subject?: BalanceSubject;
	className?: string;
}) {
	const t = useTranslations("kit.balance");
	const status = useStatusWord();
	const sign = signOf(amount);
	if (sign === 0)
		return (
			<span
				className={cn(
					"whitespace-nowrap text-small",
					toneOf("settled").text,
					className,
				)}
				data-balance="settled"
				{...figureAttrs(figure, amount)}
			>
				{status("settled")}
			</span>
		);
	const dir = sign > 0 ? "owed" : "owe";
	return (
		<span
			className={cn(
				"whitespace-nowrap text-small",
				toneOf(dir).text,
				className,
			)}
			data-balance={dir}
		>
			{words && `${t(WORDS[subject][dir])} `}
			<Money
				approx={approx}
				className="font-semibold"
				figure={figure}
				sign="never"
				value={amount}
			/>
		</span>
	);
}
