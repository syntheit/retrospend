/**
 * A mutation run by the web (no v1 route around it) appends the event
 * MUTATION_EVENTS names, in the actor's feed, with ids and no text.
 */
import { describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import type { ApplyResult } from "~/server/services/preview/types";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { recordMutationEvent } from "./scope";

const result = (value: unknown): ApplyResult<unknown> =>
	({ value, changes: [] }) as unknown as ApplyResult<unknown>;

async function run(userId: string, mutationId: string, value: unknown) {
	return userTransaction(adminDb, userId, (tx) =>
		recordMutationEvent(
			tx,
			{ id: mutationId },
			result(value),
			{ userId } as never,
		),
	);
}

describe("events from web mutations", () => {
	it("names a share answer by what was answered", async () => {
		const { user } = await createTestUser();
		expect(
			await run(user.id, "sharedExpense.answerShare", {
				answer: "reject",
				transactionId: "tx_1",
				reason: "this is not mine",
			}),
		).toBe(true);
		expect(
			await run(user.id, "sharedExpense.answerShare", {
				answer: "accept",
				transactionId: "tx_2",
			}),
		).toBe(true);
		const events = await adminDb.apiEvent.findMany({
			where: { userId: user.id },
			orderBy: { createdAt: "asc" },
		});
		expect(events.map((e) => e.type).sort()).toEqual([
			"shared_expense.accepted",
			"shared_expense.rejected",
		]);
		expect(JSON.stringify(events.map((e) => e.payload))).not.toContain(
			"not mine",
		);
	});

	it("writes the correction, fix request and move-in events the v1 routes name", async () => {
		const { user } = await createTestUser();
		for (const id of [
			"correction.apply",
			"fixRequest.ask",
			"fixRequest.respond",
			"income.moveIn",
			"income.undoMoveIn",
		])
			expect(await run(user.id, id, { id: "ent_1" })).toBe(true);
		const types = (
			await adminDb.apiEvent.findMany({ where: { userId: user.id } })
		)
			.map((e) => e.type)
			.sort();
		expect(types).toEqual([
			"fix_request.answered",
			"fix_request.created",
			"income.moved_in",
			"income.undone",
			"shared_expense.corrected",
		]);
	});

	it("appends nothing for a mutation it has no name for", async () => {
		const { user } = await createTestUser();
		expect(await run(user.id, "nothing.here", {})).toBe(false);
		expect(await adminDb.apiEvent.count({ where: { userId: user.id } })).toBe(
			0,
		);
	});
});
