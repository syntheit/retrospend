/**
 * GET /api/v1/sync/shares?budget=1 on Postgres, through the handler the Next
 * route uses (E2EE P13b PR 1c): the flag is opt-in and additive, the block
 * parses against the contract, and the raw body holds nothing of the other
 * person. The numbers are the 1a vector (services/sync/budget-block-test-support).
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	assigned,
	startClock,
	stopClock,
	vector,
	world,
} from "~/server/services/sync/budget-block-test-support";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { asMobile, call, expectBody } from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

/** Its own address, so the per-IP limit the other v1 files share is never used up. */
const OWN_IP = { "x-forwarded-for": "198.51.100.94" };

beforeAll(startClock);
afterAll(stopClock);

const get = async (userId: string, query = "") =>
	call(`/sync/shares${query}`, {
		headers: { ...OWN_IP, ...(await asMobile(userId)) },
	});

describe("the budget flag", () => {
	it("leaves the response as it was without it", async () => {
		const v = await vector();
		const res = await get(v.userId);
		const body = JSON.parse(await res.clone().text()) as Record<
			string,
			unknown
		>;
		expect(Object.keys(body).sort()).toEqual(["items", "owed"]);
		await expectBody(res, contract.sync.shares);
	});

	it("adds the block with budget=1, valid against the contract", async () => {
		const v = await vector();
		const body = await expectBody<{
			items: unknown[];
			budget: {
				bookId: string;
				frozen: unknown[];
				splits: { shares: unknown[] };
			};
		}>(await get(v.userId, "?budget=1"), contract.sync.shares);
		expect(body.items).toHaveLength(1);
		expect(body.budget.bookId).toBe(v.bookId);
		expect(body.budget.frozen).toHaveLength(1);
		expect(body.budget.splits.shares).toHaveLength(1);
	});

	it("is null for Just track and refuses a value other than 1", async () => {
		const { user } = await createTestUser();
		const body = await expectBody<{ budget: unknown }>(
			await get(user.id, "?budget=1"),
			contract.sync.shares,
		);
		expect(body.budget).toBeNull();
		const res = await get(user.id, "?budget=0");
		expect(res.status).toBe(400);
	});
});

describe("what the body holds of the other person", () => {
	/**
	 * Alice's book, a real user Bob, and a project named "Secret Trip". Bob
	 * paid a dinner Alice owes USD 20 of (an OWE), Alice paid one Bob owes USD
	 * 30 of (a FRONT), and Bob settled USD 30 (a payment to Alice). Nothing in
	 * the block may name Bob (his user id), the project, a title or a row that
	 * is not Alice's.
	 */
	it("names no one, no project, no title and no id that is not the caller's", async () => {
		const w = await world();
		await assigned(w, 202611, "Dining", "300000");
		const bob = (await createTestUser()).user.id;
		const project = await adminDb.project.create({
			data: {
				name: "Secret Trip",
				createdById: w.userId,
				primaryCurrency: "USD",
				participants: {
					create: [
						{ participantType: "user", participantId: w.userId },
						{ participantType: "user", participantId: bob },
					],
				},
			},
		});
		const expense = (paidBy: string, parts: [string, string][], day: string) =>
			fixtureDb.sharedTransaction.create({
				data: {
					description: "private dinner",
					notes: "secret note",
					amount: new Prisma.Decimal(50),
					currency: "USD",
					date: new Date(`2026-11-${day}T15:00:00Z`),
					projectId: project.id,
					categoryId: paidBy === w.userId ? w.dining : null,
					paidByType: "user",
					paidById: paidBy,
					createdByType: "user",
					createdById: paidBy,
					splitParticipants: {
						create: parts.map(([userId, amount]) => ({
							id: randomUUID(),
							participantType: "user" as const,
							participantId: userId,
							shareAmount: new Prisma.Decimal(amount),
							verificationStatus: "ACCEPTED" as const,
						})),
					},
				},
				include: { splitParticipants: true },
			});
		const owe = await expense(
			bob,
			[
				[w.userId, "20"],
				[bob, "30"],
			],
			"08",
		);
		const front = await expense(
			w.userId,
			[
				[w.userId, "20"],
				[bob, "30"],
			],
			"09",
		);
		const settlement = await adminDb.settlement.create({
			data: {
				fromParticipantType: "user",
				fromParticipantId: bob,
				toParticipantType: "user",
				toParticipantId: w.userId,
				amount: new Prisma.Decimal(30),
				currency: "USD",
				status: "FINALIZED",
				confirmedByPayer: true,
				confirmedByPayee: true,
				settledAt: new Date("2026-11-12T15:00:00Z"),
			},
		});
		const res = await get(w.userId, "?budget=1");
		const text = await res.text();
		expect(res.status, text).toBe(200);
		const budget = JSON.stringify(
			(JSON.parse(text) as { budget: unknown }).budget,
		);
		// The replay ran: Alice's OWE, her FRONT of Bob's USD 30 and Bob's payment of it.
		const splits = (
			JSON.parse(text) as {
				budget: {
					splits: { events: { kind: string; counterparty: string }[] };
				};
			}
		).budget.splits;
		expect(splits.events.map((e) => e.kind).sort()).toEqual([
			"FRONT",
			"OWE",
			"RECV",
		]);
		expect(new Set(splits.events.map((e) => e.counterparty))).toEqual(
			new Set(["p1"]),
		);
		const theirs = [
			bob,
			project.id,
			"Secret Trip",
			"private dinner",
			"secret note",
			settlement.id,
			...[owe, front].flatMap((t) =>
				t.splitParticipants
					.filter((p) => p.participantId === bob)
					.map((p) => p.id),
			),
			// The expenses themselves are Bob's or shared: no id of one is Alice's row.
			owe.id,
			front.id,
		];
		for (const leaked of theirs) expect(budget).not.toContain(leaked);
		// Alice's own participations are hers to see.
		const mine = [owe, front].flatMap((t) =>
			t.splitParticipants.filter((p) => p.participantId === w.userId),
		);
		expect(mine).toHaveLength(2);
		for (const p of mine) expect(budget).toContain(p.id);
	});
});
