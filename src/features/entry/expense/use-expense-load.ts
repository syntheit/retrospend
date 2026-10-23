"use client";

import { dayKey } from "@retrospend/domain/time-zone";
import { toMinorUnits } from "@retrospend/domain/money";
import { buildSharedExpensePrefill } from "~/lib/shared-expense-prefill";
import { generateId } from "~/lib/id";
import type { SplitRef } from "~/lib/shared-split-input";
import { api } from "~/trpc/react";
import type { EntryRequest } from "../types";
import type { ExpenseDraft, SpreadChoice } from "./draft";

type CreateRequest = Extract<EntryRequest, { kind: "expense"; mode: "create" }>;
export type ExpenseRequest =
	| CreateRequest
	| Extract<EntryRequest, { kind: "expense"; mode: "edit" }>
	| { kind: "expense"; mode: "editShared"; id: string };

export interface LoadedDraft {
	draft: ExpenseDraft;
	/** The booked home value of a saved expense (edit), shown until the rate changes. */
	bookedHome: { minor: number; currency: string } | null;
	/** Shared edit: someone already verified it, so saving asks again. */
	verified: boolean;
}

const SPREADS: SpreadChoice[] = ["2", "3", "6", "12", "24"];
const spreadOf = (n: number | undefined): SpreadChoice =>
	SPREADS.find((s) => Number(s) === n) ?? "one";

export function blankDraft(o: {
	currency: string;
	you: SplitRef;
	request?: CreateRequest;
}): ExpenseDraft {
	const p = o.request?.prefill;
	const currency = p?.currency ?? o.request?.projectCurrency ?? o.currency;
	return {
		editing: null,
		newId: generateId(),
		currency,
		amountText: "",
		minor: p?.minor ?? null,
		title: p?.title ?? "",
		categoryId: p?.categoryId ?? null,
		categoryTouched: !!p?.categoryId,
		date: dayKey(new Date()),
		rateType: null,
		custom: false,
		customText: "",
		customRate: null,
		projectId: o.request?.projectId ?? null,
		youIncluded: true,
		others: p?.with ?? [],
		paidBy: o.you,
		outsidePayer: null,
		split: "even",
		by: "amount",
		exact: {},
		pct: {},
		shares: {},
		spread: "one",
		exclude: false,
		excludeTouched: false,
		excludeAuto: false,
		note: p?.description ?? "",
		location: p?.location ?? "",
	};
}

/**
 * The saved expense an edit starts from: a personal one through
 * expense.getExpense, a shared one through sharedTransaction.getById and
 * the same prefill today's form uses (a saved split reopens as it was).
 */
export function useExpenseLoad(
	request: ExpenseRequest,
	ctx: { currency: string; you: SplitRef; ready: boolean },
): { loaded: LoadedDraft | null; failed: boolean } {
	const personalId = request.mode === "edit" ? request.id : null;
	const sharedId = request.mode === "editShared" ? request.id : null;
	const personal = api.entry.expense.get.useQuery(
		{ id: personalId ?? "" },
		{ enabled: !!personalId },
	);
	const shared = api.sharedTransaction.getById.useQuery(
		{ id: sharedId ?? "" },
		{ enabled: !!sharedId },
	);
	if (!ctx.ready) return { loaded: null, failed: false };
	const base = blankDraft({
		currency: ctx.currency,
		you: ctx.you,
		request: request.mode === "create" ? request : undefined,
	});
	if (request.mode === "create")
		return {
			loaded: { draft: base, bookedHome: null, verified: false },
			failed: false,
		};

	if (personalId) {
		const e = personal.data;
		if (!e) return { loaded: null, failed: personal.isError };
		const minor = toMinorUnits(e.amount, e.currency);
		return {
			loaded: {
				bookedHome: e.home,
				verified: false,
				draft: {
					...base,
					editing: { source: "personal", id: e.id },
					currency: e.currency,
					minor,
					title: e.title,
					categoryId: e.categoryId,
					categoryTouched: true,
					date: dayKey(new Date(e.date)),
					rateType: e.rateType,
					note: e.description ?? "",
					location: e.location ?? "",
					spread: e.isAmortizedParent ? spreadOf(e.children?.length) : "one",
					exclude: e.excludeFromAnalytics,
					excludeTouched: true,
				},
			},
			failed: false,
		};
	}

	const s = shared.data;
	if (!s) return { loaded: null, failed: shared.isError };
	const pre = buildSharedExpensePrefill(s, ctx.you);
	const toMinor = (n: number) => toMinorUnits(n, s.currency);
	return {
		loaded: {
			bookedHome: null,
			verified: s.hasVerifiedParticipants,
			draft: {
				...base,
				editing: { source: "shared", id: s.id },
				currency: s.currency,
				minor: toMinor(s.amount),
				title: s.description,
				categoryId: s.category?.id ?? null,
				categoryTouched: true,
				date: dayKey(new Date(s.date)),
				note: s.notes ?? "",
				projectId: s.projectId,
				youIncluded: pre.youIncluded,
				others: pre.splitWith,
				paidBy: pre.paidBy,
				outsidePayer: pre.outsidePayer,
				split: pre.theyOweFullAmount
					? "full"
					: pre.splitMode === "EQUAL"
						? "even"
						: "custom",
				by:
					pre.splitMode === "PERCENTAGE"
						? "pct"
						: pre.splitMode === "SHARES"
							? "shares"
							: "amount",
				exact: Object.fromEntries(
					Object.entries(pre.exactAmounts).map(([k, v]) => [k, toMinor(v)]),
				),
				pct: pre.percentages,
				shares: pre.shares,
			},
		},
		failed: false,
	};
}
