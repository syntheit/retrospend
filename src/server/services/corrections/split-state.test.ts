import { describe, expect, it } from "vitest";
import { rowStateOf, type SplitRecord } from "./split-state";

const row = (id: string, share: string, verificationStatus: string) => ({
	participantType: "user",
	participantId: id,
	shareAmount: { toString: () => share },
	verificationStatus,
});

// Ana paid 90.00; Ana, Bruno and Caro 30.00 each; Bruno rejected.
const record = (shares: ReturnType<typeof row>[], paidById = "ana") =>
	({
		paidByType: "user",
		paidById,
		categoryId: null,
		currency: "ARS",
		amount: { toString: () => "90" },
		splitParticipants: shares,
	}) as unknown as SplitRecord;

describe("rowStateOf", () => {
	it("leaves a rejected share out and gives the payer what it left uncovered", () => {
		const state = rowStateOf(
			record([
				row("ana", "30", "ACCEPTED"),
				row("bruno", "30", "REJECTED"),
				row("caro", "30", "ACCEPTED"),
			]),
		);
		expect(state.amountMinor).toBe(9000);
		expect(state.shares.map((s) => [s.party.participantId, s.minor])).toEqual([
			["ana", 6000],
			["caro", 3000],
		]);
	});

	it("adds the absorbed amount as a line when the payer had no share row", () => {
		const state = rowStateOf(
			record([row("bruno", "30", "REJECTED"), row("caro", "60", "PENDING")]),
		);
		expect(state.shares.map((s) => [s.party.participantId, s.minor])).toEqual([
			["caro", 6000],
			["ana", 3000],
		]);
	});

	it("is the plain shares when none was rejected", () => {
		const state = rowStateOf(
			record([
				row("ana", "45", "ACCEPTED"),
				row("caro", "45", "AUTO_ACCEPTED"),
			]),
		);
		expect(state.shares.map((s) => s.minor)).toEqual([4500, 4500]);
	});
});
