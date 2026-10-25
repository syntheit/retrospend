"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import type { EnvelopeTarget } from "~/components/actions/registry";
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import { useBudgetSheet } from "../use-budget-sheet";
import type { VerdictAction } from "./use-verdict-copy";
import type { PageNotice } from "./view-model";

/** Where "View activity" goes: the envelope's categories, in the month shown. */
export function activityHref(
	e: GetMonthOutput["groups"][number]["envelopes"][number],
	range: { from: string; to: string },
): string {
	const p = new URLSearchParams();
	if (e.categoryIds.length) p.set("cat", e.categoryIds.join(","));
	else p.set("q", e.name);
	p.set("from", range.from);
	p.set("to", range.to);
	return `/activity?${p.toString()}`;
}

/**
 * Every button on the page opens a sheet by id (S4C). This maps the page's
 * words (a verdict action, a notice, an envelope menu item) to those ids, so
 * the components stay about layout. The sheets agent fills the renderers.
 */
export function useBudgetActions(data: GetMonthOutput) {
	const sheet = useBudgetSheet();
	const router = useRouter();
	const month = data.month.key;
	const { from, to } = data.month;
	const rows = useMemo(
		() =>
			new Map(data.groups.flatMap((g) => g.envelopes).map((e) => [e.id, e])),
		[data.groups],
	);

	const verdict = (a: VerdictAction) => {
		const first = data.verdict.overEnvelopes[0]?.id;
		switch (a) {
			case "FIX_PLAN":
			case "TAKE_BACK":
				return sheet.open("takeBack", { month });
			case "COVER":
				return data.verdict.lead.kind === "LEFT_IN_LIMITS" && first
					? sheet.open("raiseLimit", { month, envelopeId: first })
					: sheet.open("coverAll", { month });
			case "PLAN_BILLS":
			case "USE_PLAN":
				return sheet.open("usePlan", { month });
		}
	};

	const notice = (n: PageNotice) => {
		switch (n.kind) {
			case "welcomeBack":
				return sheet.open("welcomeBack", { month });
			case "summary":
				return sheet.open("monthSummary", { month: n.month });
			case "notPlanned":
				return sheet.open("usePlan", { month });
			case "overspent":
				return sheet.open("coverAll", { month });
		}
	};

	/** The envelope menu's handlers; each id is an entry of the envelope registry. */
	const envelope = useMemo(
		() => ({
			move: (e: EnvelopeTarget) =>
				sheet.open("move", { month, envelopeId: e.id }),
			cover: (e: EnvelopeTarget) =>
				sheet.open("cover", { month, envelopeId: e.id }),
			payDebt: (e: EnvelopeTarget) =>
				sheet.open("payDebt", { month, envelopeId: e.id }),
			target: (e: EnvelopeTarget) =>
				sheet.open("target", { month, envelopeId: e.id }),
			edit: (e: EnvelopeTarget) =>
				sheet.open("editEnvelope", { month, envelopeId: e.id }),
			whatIf: (e: EnvelopeTarget) =>
				sheet.open("whatIf", { month, envelopeId: e.id }),
			activity: (e: EnvelopeTarget) => {
				const row = rows.get(e.id);
				if (row) router.push(activityHref(row, { from, to }));
			},
		}),
		[sheet, month, rows, router, from, to],
	);

	return { sheet, month, verdict, notice, envelope };
}

export type BudgetActions = ReturnType<typeof useBudgetActions>;
