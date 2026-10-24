"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import type { EnvelopeRowDto } from "~/lib/schemas/envelope";

/**
 * The target sentence under an envelope's name (B1, D29): what kind it is
 * and what it asks, as the server's target says it. Parts for RowSub.
 */
export function useTargetParts() {
	const t = useTranslations("budgetPage.target");
	const { short } = useRowDates();
	// One inline span per part: a rich message is several nodes, and the subline spaces its parts.
	const one = (node: ReactNode): ReactNode => <span>{node}</span>;
	return (
		e: EnvelopeRowDto,
		/** The plan view leaves out "more needed": the plan is what fills it. */
		o: { needed?: boolean } = {},
	): ReactNode[] => {
		const target = e.target;
		if (!target) return [t("none")];
		if (target.incomplete)
			return [t("noRate", { currency: target.foreign?.currency ?? "" })];
		const amount = target.amount;
		const asked: ReactNode = target.foreign ? (
			<Money.pair home={amount} inline original={target.foreign} />
		) : amount ? (
			<Money value={amount} />
		) : null;
		const parts: ReactNode[] = [];
		const progress = target.progress;
		if (target.kind === "MONTHLY")
			parts.push(
				one(
					t.rich(target.cadence === "WEEK" ? "perWeek" : "perMonth", {
						amount: () => asked,
					}),
				),
			);
		else if (target.kind === "BILL")
			parts.push(
				one(
					target.dueDate
						? t.rich("billDue", {
								amount: () => asked,
								date: short(target.dueDate),
							})
						: t.rich("perMonth", { amount: () => asked }),
				),
			);
		else
			parts.push(
				one(
					target.progress
						? t.rich("goalProgress", {
								saved: () => <Money value={progress} />,
								amount: () => asked,
							})
						: t.rich("goal", { amount: () => asked }),
				),
				target.dueDate ? t("goalBy", { date: short(target.dueDate) }) : null,
			);
		if (
			o.needed !== false &&
			e.status === "UNDERFUNDED" &&
			target.need.minor > 0
		)
			parts.push(
				one(
					t.rich("moreNeeded", {
						amount: () => <Money value={target.need} />,
					}),
				),
			);
		const week = e.leftThisWeek?.amount ?? null;
		if (week)
			parts.push(
				one(t.rich("leftThisWeek", { amount: () => <Money value={week} /> })),
			);
		return parts;
	};
}
