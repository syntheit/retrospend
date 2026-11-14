/**
 * Guards on the one share-counting rule (countsAsShare in the domain package),
 * so the SQL a reader runs cannot grow a rule the device does not have.
 * The same rule on real rows, server against device, is
 * figures/share-rule.pg.test.ts.
 */
import type { SyncShareDto } from "@retrospend/api-contract";
import { UNCOUNTED_SHARE_STATUSES } from "@retrospend/domain/share-status";
import type { countsAsShare, SpentShareRow } from "@retrospend/domain/spent";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createMockDb } from "~/test/mock-db";
import {
	ownParticipationWhere,
	type ShareNarrowing,
	shareParticipations,
} from "../shared-expense-integration";

describe("ownParticipationWhere", () => {
	it("is the access fragment and nothing else", () => {
		// A counting rule here would reach the device snapshot, the spending
		// shares and the list alike.
		expect(ownParticipationWhere("u1")).toEqual({
			participantType: "user",
			participantId: "u1",
		});
	});
});

describe("shareParticipations where (a pre-filter; countsAsShare decides)", () => {
	const whereOf = async (
		dateFilter?: { gte?: Date; lte?: Date },
		excludedProjectIds?: string[],
		narrow?: ShareNarrowing,
	) => {
		const db = createMockDb();
		db.splitParticipant.findMany.mockResolvedValue([]);
		await shareParticipations(
			db as never,
			"u1",
			dateFilter,
			excludedProjectIds,
			narrow,
		);
		return db.splitParticipant.findMany.mock.calls[0]?.[0]?.where;
	};

	// The pre-filter is built from the rule's own constants, and nothing else.
	const COUNTED = {
		verificationStatus: { notIn: [...UNCOUNTED_SHARE_STATUSES] },
	};

	it("holds the access fragment and the uncounted statuses with no range, hidden list or narrowing", async () => {
		expect(await whereOf()).toEqual({
			...ownParticipationWhere("u1"),
			...COUNTED,
			transaction: {},
		});
	});

	it("keeps hidden projects out with the ids it was given, and no other project rule", async () => {
		expect(await whereOf(undefined, ["hidden"])).toEqual({
			...ownParticipationWhere("u1"),
			...COUNTED,
			transaction: {
				OR: [{ projectId: null }, { projectId: { notIn: ["hidden"] } }],
			},
		});
	});

	it("adds only the date range and the Insights narrowing under the transaction", async () => {
		const gte = new Date("2026-10-01T00:00:00Z");
		const lte = new Date("2026-10-31T23:59:59Z");
		expect(
			await whereOf({ gte, lte }, ["hidden"], { projectIds: ["p1"] }),
		).toEqual({
			...ownParticipationWhere("u1"),
			...COUNTED,
			transaction: {
				date: { gte, lte },
				OR: [{ projectId: null }, { projectId: { notIn: ["hidden"] } }],
				AND: [{ projectId: { in: ["p1"] } }],
			},
		});
	});
});

describe("the rule's row", () => {
	type RuleRow = Parameters<typeof countsAsShare>[0];

	it("is made of fields the wire share and the device share both carry", () => {
		// Adding a field to the rule that a device does not hold fails here.
		expectTypeOf<keyof RuleRow>().toExtend<keyof SyncShareDto>();
		expectTypeOf<keyof RuleRow>().toExtend<keyof SpentShareRow>();
	});
});
