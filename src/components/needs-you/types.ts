/**
 * Needs you items: everything waiting on the person, one typed union so every
 * kind has one sentence, one icon and one action. The list itself arrives
 * from the server's needsYou read model (stream 2E); amounts are Money the
 * server computed (R9).
 */
import type { MoneyValue } from "~/components/money/format";

type Base = {
	id: string;
	href?: string;
	/** Figures registry key of the item's amount, for the audit. */
	figure?: string;
	/** One fact under the sentence ("Was due Oct 8", "Your share BRL 155.00"). */
	context?: string;
};

export type NeedsYouItemVM =
	/** Budget money with no job yet ("Give ARS 850,000 a job"). */
	| (Base & { kind: "assign"; amount: MoneyValue })
	/** Imported rows waiting for review. */
	| (Base & { kind: "review"; count: number })
	/** Someone says they paid you; you confirm the money arrived. */
	| (Base & { kind: "confirmPayment"; person: string; amount: MoneyValue })
	/** Someone added you to a shared expense; you review your share. */
	| (Base & {
			kind: "verify";
			person: string;
			title: string;
			amount: MoneyValue;
	  })
	/** A recurring expense due today. */
	| (Base & { kind: "due"; title: string; amount: MoneyValue })
	/** A recurring expense past its date. */
	| (Base & { kind: "overdue"; title: string; amount: MoneyValue })
	/** An envelope that spent more than it had. */
	| (Base & { kind: "overspent"; envelope: string; amount: MoneyValue })
	/** Several envelopes over; the amount is what they are over in total. */
	| (Base & { kind: "overspentMany"; count: number; amount: MoneyValue })
	/** Someone rejected a split you made; the amount is their share. */
	| (Base & {
			kind: "rejected";
			person: string;
			title: string;
			amount: MoneyValue;
	  })
	/** More is planned than there is. */
	| (Base & { kind: "overAssigned"; amount: MoneyValue })
	/** Bills due soon that are not fully funded; a title when there is one. */
	| (Base & {
			kind: "billDue";
			title: string | null;
			count: number;
			amount: MoneyValue;
	  })
	/** Currencies without a rate keep totals out, named (R14). */
	| (Base & { kind: "missingRate"; currencies: string[] })
	/** The budget's starting money waits for a confirm. */
	| (Base & { kind: "startingMoney" })
	/** New-user setup prompts (no amount). */
	| (Base & { kind: "firstExpense" })
	| (Base & { kind: "homeCurrency" })
	| (Base & { kind: "verifyEmail" })
	| (Base & { kind: "importStatement" });

export type NeedsYouKind = NeedsYouItemVM["kind"];
