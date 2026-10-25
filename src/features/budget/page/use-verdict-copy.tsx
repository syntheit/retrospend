"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import type { VerdictDto } from "~/lib/schemas/envelope";

type Verdict = VerdictDto;
type Action = NonNullable<Verdict["action"]>;

/** What a verdict's button does; the page turns each into a sheet. */
export type VerdictAction = Action;

/**
 * The words of the verdict (SYNTHESIS-r6 §4): the label over the number, the
 * one sentence and the notice. The server picks the state and carries every
 * figure; this only turns them into text, with each amount through Money.
 */
export function useVerdictCopy({
	names,
	month,
	next,
}: {
	/** Envelope names by id, for "Restaurants went over by". */
	names: ReadonlyMap<string, string>;
	/** "October" and "November": the month shown and the one after. */
	month: string;
	next: string;
}) {
	const t = useTranslations("budgetPage.verdict");
	const format = useFormatter();
	const { day } = useRowDates();

	const list = (ids: string[]) =>
		format.list(
			ids.map((id) => names.get(id) ?? "").filter((n) => n !== ""),
			{ type: "conjunction" },
		);

	const label = (v: Verdict, saveFirst: boolean): string => {
		switch (v.lead.kind) {
			case "TO_ASSIGN":
				return t("label.toAssign");
			case "LEFT_THIS_WEEK":
				return t("label.week");
			case "LEFT_IN_LIMITS":
				return v.state === "OVER_BUDGET"
					? t("label.overLimits")
					: t("label.limits");
			default:
				if (v.state === "OVER_BUDGET") return t("label.overBudget", { month });
				return saveFirst
					? t("label.saveFirst")
					: t("label.leftToSpend", { month });
		}
	};

	const sentence = (v: Verdict): ReactNode => {
		const amount = () => <Money value={v.perDay} />;
		const over = () => <Money value={v.over} />;
		const days = v.daysLeft;
		const limits = v.lead.kind === "LEFT_IN_LIMITS";
		switch (v.state) {
			case "PLANNED_TOO_MUCH":
				return t.rich("plannedTooMuch", {
					amount: () => <Money value={v.plannedTooMuch} />,
				});
			case "OVER_BUDGET":
				return limits
					? t.rich("limitsOver", {
							amount: () => <Money sign="never" value={v.lead.amount} />,
						})
					: t.rich("overBudget", {
							amount: () => <Money sign="never" value={v.lead.amount} />,
							month,
							next,
						});
			case "BILLS_SHORT":
				return t.rich("billsShort", {
					amount: () => <Money value={v.billsShort} />,
				});
			case "USED_UP":
				return t(limits ? "limitsUsedUp" : "usedUp", { month, next });
			case "FASTER_THAN_PLANNED":
				return t.rich(limits ? "limitsFaster" : "faster", { amount });
			case "SOME_OVER":
				return t.rich(limits ? "limitsSomeOver" : "someOver", {
					amount,
					over,
					days,
					names: list(v.overEnvelopes.map((e) => e.id)),
				});
			case "ON_TRACK":
				return t.rich(limits ? "limitsOnTrack" : "onTrack", { amount, days });
			case "ALL_ASSIGNED":
				return t("allAssigned");
			case "NEEDS_JOB":
				return t.rich("needsJob", {
					amount: () => <Money value={v.lead.amount} />,
				});
			case "OVER_ASSIGNED":
				return t.rich("overAssigned", {
					amount: () => <Money sign="never" value={v.lead.amount} />,
				});
			case "WEEK_LEFT":
				return t.rich("weekLeft", {
					amount,
					resets: v.resetsOn ? day(v.resetsOn) : "",
				});
			case "WEEK_USED":
				return t("weekUsed", { resets: v.resetsOn ? day(v.resetsOn) : "" });
		}
	};

	const actionLabel = (a: Action, limits: boolean): string =>
		limits && a === "COVER" ? t("action.raiseLimit") : t(`action.${a}`);

	return { label, sentence, actionLabel };
}
