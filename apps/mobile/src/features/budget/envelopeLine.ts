import type { Money } from "@retrospend/domain/money-minor";
import type { BudgetEnvelope, BudgetGroup } from "./source";

// What an envelope row says under its name, and how its Left reads at the end.
// The server decides every figure and status; this only picks which of the
// envelope's own values go into the sentence (the same pick as the web's
// `useTargetParts` and `AvailablePill`).

/** The target sentence under an envelope's name, before it is worded. */
export type TargetLine =
	| { kind: "none" }
	| { kind: "noRate"; currency: string }
	| {
			kind: "monthly";
			cadence: "MONTH" | "WEEK";
			amount: Money;
			foreign: Money | null;
	  }
	| {
			kind: "bill";
			amount: Money;
			dueDate: string | null;
			foreign: Money | null;
	  }
	| {
			kind: "goal";
			amount: Money;
			saved: Money | null;
			dueDate: string | null;
			foreign: Money | null;
	  };

/**
 * The target as one sentence's parts. An envelope with no target says so; a
 * target in a currency with no rate says that and no figure (never a 0).
 */
export function targetLine(e: Pick<BudgetEnvelope, "target">): TargetLine {
	const target = e.target;
	if (!target) return { kind: "none" };
	if (target.incomplete) {
		return { kind: "noRate", currency: target.foreign?.currency ?? "" };
	}
	const amount = target.amount;
	if (!amount) return { kind: "none" };
	switch (target.kind) {
		case "MONTHLY":
			return {
				kind: "monthly",
				cadence: target.cadence === "WEEK" ? "WEEK" : "MONTH",
				amount,
				foreign: target.foreign,
			};
		case "BILL":
			return {
				kind: "bill",
				amount,
				dueDate: target.dueDate,
				foreign: target.foreign,
			};
		case "SAVINGS":
			return {
				kind: "goal",
				amount,
				saved: target.progress,
				dueDate: target.dueDate,
				foreign: target.foreign,
			};
	}
}

/** How an envelope's Left reads at the end of its row. */
export type LeftAtom =
	| { kind: "over"; amount: Money }
	| { kind: "needed"; left: Money; need: Money }
	| { kind: "plain"; left: Money; zero: boolean };

/**
 * An over envelope is a pill that says how far over; a short one shows its
 * Left with "more needed" under it; the rest is a plain amount, quiet when it
 * is zero.
 */
export function leftAtom(
	e: Pick<BudgetEnvelope, "status" | "left" | "target">,
): LeftAtom {
	if (e.status === "OVERSPENT") return { kind: "over", amount: e.left };
	if (e.status === "UNDERFUNDED" && e.target && e.target.need.minor > 0) {
		return { kind: "needed", left: e.left, need: e.target.need };
	}
	return { kind: "plain", left: e.left, zero: e.left.minor === 0 };
}

/**
 * A bar length: the server's basis points (0 to 10000) as a percent. An
 * envelope's is null for a goal, a group's when it holds nothing.
 */
export function envelopeSpentPercent(
	e: Pick<BudgetEnvelope, "spentBasis">,
): number | null {
	return e.spentBasis === null ? null : e.spentBasis / 100;
}
