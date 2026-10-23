/** Money owed as the budget sees it: per person, held, pending, age (C15). */
import { describe, expect, it } from "vitest";
import { OWED_AGING_DAYS, owedDto, owedSummary } from "./owed";
import { type ReplayEvent, replaySplits } from "./splits-replay";

const front = (
	id: string,
	who: string,
	date: string,
	native: number,
): ReplayEvent => ({
	kind: "FRONT",
	id,
	counterparty: who,
	currency: "ARS",
	date,
	month: Number(date.slice(0, 4) + date.slice(5, 7)),
	native,
	value: native,
});
const recv = (
	id: string,
	who: string,
	date: string,
	native: number,
): ReplayEvent => ({
	kind: "RECV",
	id,
	counterparty: who,
	currency: "ARS",
	date,
	month: Number(date.slice(0, 4) + date.slice(5, 7)),
	native,
	cash: native,
	status: "FINALIZED",
});

function owed(events: ReplayEvent[], today: string) {
	const input = {
		replay: replaySplits(events),
		events,
		pending: [
			{
				id: "pp",
				counterparty: "user:juan",
				currency: "ARS",
				native: 500,
				cash: 500,
				date: today,
			},
		],
		notInBudget: [],
		currency: "ARS",
		today,
		names: new Map([["user:paz", "Paz"]]),
		incomplete: false,
	};
	return { dto: owedDto(input), summary: owedSummary(input) };
}

describe("owed (SPEC §5.8, §6.9)", () => {
	// Paz: 3,000 on Jul 1 and 2,000 on Aug 1; she pays 3,000 on Aug 10, which
	// clears the July part first (first in, first out).
	const events = [
		front("f1", "user:paz", "2026-07-01", 3_000),
		front("f2", "user:paz", "2026-08-01", 2_000),
		recv("r1", "user:paz", "2026-08-10", 3_000),
		front("f3", "user:juan", "2026-10-01", 1_000),
	];

	it("lists what each person owes, what is held for it, and the pending payments", () => {
		const { dto } = owed(events, "2026-10-20");
		expect(dto.held).toEqual({ minor: 3_000, currency: "ARS" });
		expect(dto.pending).toEqual({ minor: 500, currency: "ARS" });
		const paz = dto.people.find((p) => p.participant.id === "paz");
		expect(paz).toMatchObject({
			participant: { type: "user", id: "paz" },
			name: "Paz",
			held: { minor: 2_000, currency: "ARS" },
			lastPaidOn: "2026-08-10",
			lines: [
				{
					amount: { minor: 2_000, currency: "ARS" },
					oldestOpen: "2026-08-01",
					ageDays: 80,
				},
			],
		});
	});

	it(`after ${OWED_AGING_DAYS} days owed with no payment in ${OWED_AGING_DAYS} days, the person is aging`, () => {
		const { dto, summary } = owed(events, "2026-10-20");
		// Paz: open since Aug 1 (80 days), last paid Aug 10 (71 days ago).
		expect(dto.people.find((p) => p.participant.id === "paz")?.aging).toBe(
			true,
		);
		// Juan: 19 days.
		expect(dto.people.find((p) => p.participant.id === "juan")?.aging).toBe(
			false,
		);
		expect(summary).toEqual({
			held: { minor: 3_000, currency: "ARS" },
			pending: { minor: 500, currency: "ARS" },
			people: 2,
			aging: 1,
		});
	});

	it("a recent payment keeps an old balance from aging", () => {
		const { dto } = owed(
			[...events, recv("r2", "user:paz", "2026-10-01", 500)],
			"2026-10-20",
		);
		expect(dto.people.find((p) => p.participant.id === "paz")?.aging).toBe(
			false,
		);
	});
});
