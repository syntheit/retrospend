import { describe, expect, it } from "vitest";
import { resolveSplits } from "@retrospend/domain/shared-split-computation";
import {
	buildSharedExpensePrefill,
	type SharedTxForPrefill,
} from "./shared-expense-prefill";

const me = { participantType: "user" as const, participantId: "me" };
const person = (id: string, name = id) => ({
	participantType: "user",
	participantId: id,
	name,
	avatarUrl: null,
});

function row(id: string, shareAmount: number, extra: Record<string, unknown> = {}) {
	return { ...person(id), shareAmount, ...extra };
}

describe("buildSharedExpensePrefill", () => {
	it("reopens 'they owe the full amount' (I paid, one full row for them) with the toggle on", () => {
		const tx: SharedTxForPrefill = {
			amount: 80,
			splitMode: "EXACT",
			paidBy: person("me", "Me"),
			splitParticipants: [row("olga", 80)],
		};
		const prefill = buildSharedExpensePrefill(tx, me);

		expect(prefill.paidBy).toEqual(me);
		expect(prefill.youIncluded).toBe(true);
		expect(prefill.theyOweFullAmount).toBe(true);
		expect(prefill.splitMode).toBe("EQUAL");
		expect(prefill.splitWith.map((p) => p.participantId)).toEqual(["olga"]);
		expect(prefill.outsidePayer).toBeNull();
	});

	it("reopens 'you owe the full amount' (they paid, one full row for me) with them as the payer", () => {
		const tx: SharedTxForPrefill = {
			amount: 80,
			splitMode: "EXACT",
			paidBy: person("olga", "Olga"),
			splitParticipants: [row("me", 80)],
		};
		const prefill = buildSharedExpensePrefill(tx, me);

		expect(prefill.paidBy).toEqual({ participantType: "user", participantId: "olga" });
		expect(prefill.youIncluded).toBe(true);
		expect(prefill.theyOweFullAmount).toBe(true);
		expect(prefill.splitWith).toEqual([
			{
				participantType: "user",
				participantId: "olga",
				name: "Olga",
				email: null,
				avatarUrl: null,
			},
		]);
	});

	it("keeps a payer who paid for others without a share", () => {
		const tx: SharedTxForPrefill = {
			amount: 60,
			splitMode: "EQUAL",
			paidBy: person("me", "Me"),
			splitParticipants: [row("a", 30), row("b", 30)],
		};
		const prefill = buildSharedExpensePrefill(tx, me);

		expect(prefill.paidBy).toEqual(me);
		expect(prefill.youIncluded).toBe(false);
		expect(prefill.theyOweFullAmount).toBe(false);
		expect(prefill.splitWith.map((p) => p.participantId)).toEqual(["a", "b"]);
		expect(prefill.outsidePayer).toMatchObject({ participantId: "me", name: "Me" });

		// Round trip: the form submits the same split it was opened with.
		const resubmitted = resolveSplits({
			mode: prefill.splitMode,
			currency: "USD",
			amount: tx.amount,
			participants: prefill.splitWith.map((p) => ({
				participantType: p.participantType,
				participantId: p.participantId,
			})),
			paidBy: prefill.paidBy,
		});
		expect(resubmitted.map((r) => [r.participantId, r.shareAmount])).toEqual([
			["a", 30],
			["b", 30],
		]);
	});

	it("keeps a third-person payer outside the split", () => {
		const tx: SharedTxForPrefill = {
			amount: 50,
			splitMode: "EQUAL",
			paidBy: person("carol", "Carol"),
			splitParticipants: [row("me", 25), row("dan", 25)],
		};
		const prefill = buildSharedExpensePrefill(tx, me);

		expect(prefill.paidBy).toEqual({ participantType: "user", participantId: "carol" });
		expect(prefill.youIncluded).toBe(true);
		expect(prefill.theyOweFullAmount).toBe(false);
		expect(prefill.splitWith.map((p) => p.participantId)).toEqual(["dan"]);
		expect(prefill.outsidePayer).toMatchObject({ participantId: "carol", name: "Carol" });
	});

	it("maps a normal split with the payer included and restores per-mode values", () => {
		const tx: SharedTxForPrefill = {
			amount: 100,
			splitMode: "PERCENTAGE",
			paidBy: person("me", "Me"),
			splitParticipants: [
				row("me", 60, { sharePercentage: 60 }),
				row("olga", 40, { sharePercentage: 40 }),
			],
		};
		const prefill = buildSharedExpensePrefill(tx, me);

		expect(prefill.youIncluded).toBe(true);
		expect(prefill.theyOweFullAmount).toBe(false);
		expect(prefill.outsidePayer).toBeNull();
		expect(prefill.splitMode).toBe("PERCENTAGE");
		expect(prefill.percentages).toEqual({ "user:me": 60, "user:olga": 40 });
	});

	it("does not treat a partial single-row expense as full amount", () => {
		const tx: SharedTxForPrefill = {
			amount: 100,
			splitMode: "EXACT",
			paidBy: person("me", "Me"),
			splitParticipants: [row("olga", 40)],
		};
		const prefill = buildSharedExpensePrefill(tx, me);

		expect(prefill.theyOweFullAmount).toBe(false);
		expect(prefill.splitMode).toBe("EXACT");
		expect(prefill.exactAmounts).toEqual({ "user:olga": 40 });
		expect(prefill.outsidePayer).toMatchObject({ participantId: "me" });
	});
});
