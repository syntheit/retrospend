"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Money } from "~/components/money/money";
import { usePercent } from "~/components/rows/percent";
import type { RouterOutputs } from "~/trpc/react";

export type Rule = RouterOutputs["envelope"]["rules"][number];

/**
 * A rule in one sentence (SPEC §6.10): "20% of money in to Savings", "ARS
 * 5,000 to Rent", "The rest to Spending". The server's own amounts and
 * percentages, worded; nothing is computed.
 */
export function useRuleSentence() {
	const t = useTranslations("budgetSheets.rules.sentence");
	const percent = usePercent();
	return (rule: Rule, envelopeName: string): ReactNode => {
		const a = rule.action;
		if (a.kind === "PERCENT" && a.basisPoints !== null)
			return t("percent", {
				percent: percent(a.basisPoints, { digits: 0 }),
				name: envelopeName,
			});
		if (a.kind === "AMOUNT" && a.amount)
			return t.rich("amount", {
				amount: () => <Money value={a.amount} />,
				name: envelopeName,
			});
		return t("rest", { name: envelopeName });
	};
}
