"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import type { EnvelopeTarget } from "~/components/actions/registry";
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import type { BudgetSheetId } from "../sheet-ids";
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

/** Sheets whose only argument is the month shown. */
export type MonthSheet =
	| "income"
	| "usePlan"
	| "debt"
	| "payDebt"
	| "monthSummary"
	| "whatIf"
	| "newEnvelope"
	| "mergeEnvelopes"
	| "rules"
	| "style"
	| "help"
	| "afford"
	| "coverAll"
	| "takeBack"
	| "owed"
	| "splits";

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

	/** Open a sheet that takes only the month; a missing sheet does nothing. */
	const openMonth = (id: MonthSheet) =>
		(sheet.open as (id: BudgetSheetId, args: { month: number }) => void)(id, {
			month,
		});

	/** The sheet a verdict button opens (Limits raises the limit that went over). */
	const verdictSheet = (a: VerdictAction): BudgetSheetId => {
		switch (a) {
			case "FIX_PLAN":
			case "TAKE_BACK":
				return "takeBack";
			case "COVER":
				return data.verdict.lead.kind === "LEFT_IN_LIMITS" &&
					data.verdict.overEnvelopes[0]
					? "raiseLimit"
					: "coverAll";
			case "PLAN_BILLS":
			case "USE_PLAN":
				return "usePlan";
		}
	};

	const verdict = (a: VerdictAction) => {
		const first = data.verdict.overEnvelopes[0]?.id;
		const id = verdictSheet(a);
		if (id === "raiseLimit" && first)
			return sheet.open("raiseLimit", { month, envelopeId: first });
		return openMonth(id as MonthSheet);
	};

	/** The sheet a notice's button opens. */
	const noticeSheet = (n: PageNotice): BudgetSheetId => {
		switch (n.kind) {
			case "welcomeBack":
				return "welcomeBack";
			case "summary":
				return "monthSummary";
			case "notPlanned":
				return "usePlan";
			case "overspent":
				return "coverAll";
		}
	};

	const notice = (n: PageNotice) => {
		if (n.kind === "summary")
			return sheet.open("monthSummary", { month: n.month });
		return (sheet.open as (id: BudgetSheetId, args: { month: number }) => void)(
			noticeSheet(n),
			{ month },
		);
	};

	/**
	 * The envelope menu's handlers; each id is an entry of the envelope
	 * registry. An action whose sheet does not exist is left out, so the menu
	 * never offers a button that does nothing.
	 */
	const envelope = useMemo(() => {
		const open = (id: BudgetSheetId) => (e: EnvelopeTarget) =>
			(
				sheet.open as (
					id: BudgetSheetId,
					args: { month: number; envelopeId: string },
				) => void
			)(id, { month, envelopeId: e.id });
		const sheets: Record<string, BudgetSheetId> = {
			move: "move",
			cover: "cover",
			payDebt: "payDebt",
			target: "target",
			edit: "editEnvelope",
			whatIf: "whatIf",
		};
		const handlers: Record<string, (e: EnvelopeTarget) => void> = {};
		for (const [action, id] of Object.entries(sheets))
			if (sheet.has(id)) handlers[action] = open(id);
		return {
			...handlers,
			activity: (e: EnvelopeTarget) => {
				const row = rows.get(e.id);
				if (row) router.push(activityHref(row, { from, to }));
			},
		};
	}, [sheet, month, rows, router, from, to]);

	/** Whether a sheet exists; a button for one that does not is not shown. */
	const can = (id: BudgetSheetId) => sheet.has(id);

	return {
		sheet,
		month,
		verdict,
		verdictSheet,
		notice,
		noticeSheet,
		envelope,
		openMonth,
		can,
	};
}

export type BudgetActions = ReturnType<typeof useBudgetActions>;
