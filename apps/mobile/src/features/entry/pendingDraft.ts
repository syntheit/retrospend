import { toMinor } from "@retrospend/domain/money-minor";
import { draftFromMinor } from "@retrospend/domain/parse";
import type { OutboxEntry } from "@/data/outbox";
import { DEFAULT_RATE, type RateChoice } from "./draftAmount";
import { type ExpenseDraft, newExpenseDraft } from "./draftExpense";
import { type IncomeDraft, newIncomeDraft } from "./draftIncome";
import type { TransferDraft } from "./draftTransfer";
import { type EntryMode, personKey } from "./types";

// An entry that waits in the outbox can still be edited: the composer opens on
// it, filled in from the write it holds, and Save replaces that write. These
// are the pure steps from a waiting write back to a draft.

export interface RestoredDraft {
	mode: EntryMode;
	expense?: ExpenseDraft;
	income?: IncomeDraft;
	transfer?: TransferDraft;
}

type Body = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function amountText(
	amount: unknown,
	currency: string,
	locale: string,
): string | null {
	if (typeof amount !== "string" || !currency) return null;
	try {
		return draftFromMinor(toMinor(amount, currency), locale, currency);
	} catch {
		return null;
	}
}

/** The rate part back as a choice: a typed rate stays exactly as it was sent. */
function rateChoice(body: Body): RateChoice {
	if (typeof body.customRate === "string") {
		return { ...DEFAULT_RATE, custom: true, savedRate: body.customRate };
	}
	return {
		...DEFAULT_RATE,
		rateType: typeof body.rateType === "string" ? body.rateType : null,
	};
}

function people(body: Body): { type: string; id: string }[] {
	const list = Array.isArray(body.splitWith) ? body.splitWith : [];
	return list.filter(
		(p): p is { type: string; id: string } =>
			typeof p === "object" &&
			p !== null &&
			typeof (p as Body).type === "string" &&
			typeof (p as Body).id === "string",
	);
}

/**
 * Whether the composer can open on this waiting write. A split that is not
 * equal, or one inside a project, carries parts and people the composer cannot
 * rebuild from the write, so those are deleted and added again instead.
 */
export function canRestore(entry: OutboxEntry): boolean {
	if (entry.kind !== "create") return false;
	if (entry.entity === "shared-expenses") {
		const body = (entry.payload ?? {}) as Body;
		return body.splitMode === "EQUAL" && !body.projectId;
	}
	return (
		entry.entity === "expenses" ||
		entry.entity === "income" ||
		entry.entity === "transfers"
	);
}

/** The draft a waiting write was made from, or null when it can not be rebuilt. */
export function restoreDraft(
	entry: OutboxEntry,
	input: { locale: string; meId: string },
): RestoredDraft | null {
	if (!canRestore(entry)) return null;
	const body = (entry.payload ?? {}) as Body;
	const { locale } = input;
	const id = entry.clientId;
	const date = str(body.date);
	if (entry.entity === "transfers") {
		const fromCurrency = str(body.fromCurrency);
		const toCurrency = str(body.toCurrency);
		const out = amountText(body.fromAmount, fromCurrency, locale);
		if (out === null) return null;
		const fee = (body.fee ?? null) as Body | null;
		return {
			mode: "transfer",
			transfer: {
				id,
				fromId: str(body.fromAccountId) || null,
				toId: str(body.toAccountId) || null,
				amountText: out,
				receivedText: amountText(body.toAmount, toCurrency, locale) ?? "",
				note: str(body.note),
				date,
				feeText: fee
					? (amountText(fee.amount, fromCurrency, locale) ?? "")
					: "",
			},
		};
	}
	const currency = str(body.currency);
	const text = amountText(body.amount, currency, locale);
	if (text === null) return null;
	if (entry.entity === "income") {
		return {
			mode: "income",
			income: {
				...newIncomeDraft({
					id,
					currency,
					date,
					usePlan: body.usePlan === true,
				}),
				...rateChoice(body),
				amountText: text,
				source: str(body.title),
				note: str(body.description),
				categoryId: str(body.categoryId) || null,
				into: str(body.into) || null,
				repeats: body.repeats !== undefined,
			},
		};
	}
	const base = {
		...newExpenseDraft({ id, currency, date }),
		amountText: text,
		categoryId: str(body.categoryId) || null,
		// A saved choice stays the person's, whatever the category says.
		excludeTouched: true,
	};
	if (entry.entity === "shared-expenses") {
		const others = people(body).filter(
			(p) => !(p.type === "user" && p.id === input.meId),
		);
		const paidBy = (body.paidBy ?? null) as { type: string; id: string } | null;
		const paidByMe =
			!paidBy || (paidBy.type === "user" && paidBy.id === input.meId);
		return {
			mode: "expense",
			expense: {
				...base,
				title: str(body.description),
				note: str(body.notes),
				withKeys: others.map((p) =>
					personKey({ type: p.type as "user", id: p.id }),
				),
				paidByKey:
					paidByMe || !paidBy
						? null
						: personKey({ type: paidBy.type as "user", id: paidBy.id }),
			},
		};
	}
	return {
		mode: "expense",
		expense: {
			...base,
			...rateChoice(body),
			title: str(body.title),
			location: str(body.location),
			note: str(body.description),
			spread: typeof body.amortizeOver === "number" ? body.amortizeOver : null,
			exclude: body.excludeFromAnalytics === true,
		},
	};
}
