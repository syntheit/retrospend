"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { AvailablePill } from "~/components/money/available-pill";
import { signOf } from "~/components/money/format";
import { Money } from "~/components/money/money";
import { usePercent } from "~/components/rows/percent";
import type { Shrinkable } from "~/components/rows/row";
import type { EnvelopeGroupDto } from "~/lib/schemas/envelope";
import { overEnvelopes } from "./view-model";

/** A group's name: the one the person gave it, else its role's word. */
export function useGroupName() {
	const t = useTranslations("budgetPage.group");
	return (g: EnvelopeGroupDto): string =>
		g.name ?? (g.role ? t(`role.${g.role}`) : t("ungrouped"));
}

/**
 * What a folded group row says under its name: which envelopes are over,
 * else whether its bills are covered, else the envelopes it holds. A group
 * with a % target leads with "planned 30% · spent 31%" (SPEC §5.9).
 */
export function useGroupSub() {
	const t = useTranslations("budgetPage.group");
	const name = useGroupName();
	const percent = usePercent();
	return (g: EnvelopeGroupDto): (ReactNode | Shrinkable)[] => {
		const parts: (ReactNode | Shrinkable)[] = [];
		const target = g.target;
		if (
			target?.kind === "PERCENT_OF_INCOME" &&
			!target.incomplete &&
			target.plannedBp != null &&
			target.spentBp != null
		)
			parts.push(
				t("percents", {
					planned: percent(target.plannedBp, { digits: 0 }),
					spent: percent(target.spentBp, { digits: 0 }),
				}),
			);
		const over = overEnvelopes(g);
		if (over.length > 0)
			parts.push(
				...over.slice(0, 2).map((e) =>
					t.rich("overBy", {
						name: e.name,
						amount: () => <Money sign="never" value={e.left} />,
					}),
				),
			);
		else if (g.role === "BILLS")
			parts.push(
				g.totals.need.minor > 0
					? t.rich("needed", {
							name: name(g),
							amount: () => <Money value={g.totals.need} />,
						})
					: t("covered", { name: name(g) }),
			);
		else
			parts.push({
				shrink: g.envelopes.map((e) => e.name).join(", "),
			});
		return parts;
	};
}

/**
 * A group's Left: a plain amount, or the pill when it is over. Limits books
 * judge the group by its net Left over the envelopes with a limit (the
 * hero's own figure); the others by the server's `over` total. Never a sum
 * here.
 */
export function GroupLeft({
	group,
	limits = false,
}: {
	group: EnvelopeGroupDto;
	limits?: boolean;
}) {
	const { totals } = group;
	const left = limits ? (totals.limitLeft ?? totals.left) : totals.left;
	const over = limits ? (signOf(left) < 0 ? left : null) : totals.over;
	if (over && over.minor !== 0)
		return <AvailablePill amount={over} status="overspent" />;
	return <Money className="font-semibold" value={left} />;
}
