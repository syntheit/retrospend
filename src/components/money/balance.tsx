"use client";

import { useTranslations } from "next-intl";
import { cn } from "~/lib/cn";
import { type MoneyValue, signOf } from "./format";
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
 * Balance (R5, D1): an amount with its words. Positive means money coming to
 * you (positive color plus "owes you"); negative is plain text with "you
 * owe", because owing is not an alarm; zero reads "Settled" in fg-3. The
 * words carry the sign, so the amount shows none. Owed to you and You owe
 * are separate figures from the server, never netted here.
 */
export function Balance({
	amount,
	subject = "person",
	className,
}: {
	amount: MoneyValue;
	subject?: BalanceSubject;
	className?: string;
}) {
	const t = useTranslations("kit.balance");
	const sign = signOf(amount);
	if (sign === 0)
		return (
			<span
				className={cn("whitespace-nowrap text-fg-3 text-small", className)}
				data-balance="settled"
			>
				{t("settled")}
			</span>
		);
	const dir = sign > 0 ? "owed" : "owe";
	return (
		<span
			className={cn(
				"whitespace-nowrap text-small",
				dir === "owed" ? "text-positive" : "text-owe",
				className,
			)}
			data-balance={dir}
		>
			{t(WORDS[subject][dir])}{" "}
			<Money className="font-semibold" sign="never" value={amount} />
		</span>
	);
}
