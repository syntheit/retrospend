import { describe, expect, it, vi } from "vitest";
import { canonicalizeProjectLedger } from "./identity";
import { addProjectParticipant, createStatefulDb } from "./test-utils";

type Ref = { participantType: "user" | "shadow"; participantId: string };

function tx(payer: Ref, splits: Array<Ref & { shareAmount: number }>) {
	return {
		currency: "USD",
		amount: splits.reduce((s, sp) => s + sp.shareAmount, 0),
		paidByType: payer.participantType,
		paidById: payer.participantId,
		splitParticipants: splits,
	};
}

function settlement(from: Ref, to: Ref, amount: number) {
	return {
		fromParticipantType: from.participantType,
		fromParticipantId: from.participantId,
		toParticipantType: to.participantType,
		toParticipantId: to.participantId,
		amount,
		currency: "USD",
	};
}

const alice: Ref = { participantType: "user", participantId: "alice" };
const bob: Ref = { participantType: "user", participantId: "bob" };
const shadowBob: Ref = { participantType: "shadow", participantId: "s-bob" };

function dbWithClaimedShadow() {
	const db = createStatefulDb();
	db._stores.shadowProfiles.set("s-bob", {
		id: "s-bob",
		name: "Bobby",
		email: null,
		phone: null,
		createdById: "alice",
		claimedById: "bob",
	});
	return db;
}

describe("canonicalizeProjectLedger", () => {
	it("returns the ledger untouched without reading the DB when no shadow is involved", async () => {
		const db = createStatefulDb();
		const findMany = vi.spyOn(db.projectParticipant, "findMany");
		const txs = [tx(alice, [{ ...bob, shareAmount: 10 }])];
		const settlements = [settlement(bob, alice, 10)];

		const out = await canonicalizeProjectLedger(db as never, "P", txs, settlements);

		expect(out.transactions).toBe(txs);
		expect(out.settlements).toBe(settlements);
		expect(findMany).not.toHaveBeenCalled();
	});

	it("merges a claimed shadow into its user, summing their rows on one expense", async () => {
		const db = dbWithClaimedShadow();
		const out = await canonicalizeProjectLedger(
			db as never,
			"P",
			[
				tx(alice, [
					{ ...shadowBob, shareAmount: 10 },
					{ ...bob, shareAmount: 5 },
				]),
			],
			[],
		);

		expect(out.transactions[0]!.splitParticipants).toEqual([
			{ participantType: "user", participantId: "bob", shareAmount: 15 },
		]);
	});

	it("keeps the alias that is the project member and drops settlements that become self-payments", async () => {
		const db = dbWithClaimedShadow();
		// Legacy data: the shadow is still the project member.
		addProjectParticipant(db, {
			projectId: "P",
			participantType: "shadow",
			participantId: "s-bob",
			role: "CONTRIBUTOR",
		});

		const out = await canonicalizeProjectLedger(
			db as never,
			"P",
			[tx(alice, [{ ...bob, shareAmount: 10 }])],
			[settlement(bob, alice, 4), settlement(bob, shadowBob, 1)],
		);

		expect(out.transactions[0]!.splitParticipants[0]).toMatchObject(shadowBob);
		expect(out.settlements).toEqual([settlement(shadowBob, alice, 4)]);
	});
});
