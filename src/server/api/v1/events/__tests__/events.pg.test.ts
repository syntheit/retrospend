/**
 * The event outbox and GET /api/v1/events on Postgres: an event commits or
 * rolls back with its write, the feed is per user, in commit order and
 * paged by cursor, and no event carries a title or a note. Requests go
 * through the same handler the Next route uses.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { appendEvent } from "~/server/services/events/outbox";
import { forUser } from "~/server/services/preview";
import type { MoneyMutation } from "~/server/services/preview/types";
import {
	adminDb,
	asKey,
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

type Feed = {
	items: {
		id: string;
		cursor: string;
		type: string;
		actorUserId: string | null;
		entity: { type: string; id: string } | null;
		data: {
			ids: Record<string, string>;
			amounts: { name: string; minor: number; currency: string }[];
		};
	}[];
	cursor: string | null;
	hasMore: boolean;
};

const empty = { ids: {}, amounts: [], truncated: false };
const today = () => new Date().toISOString().slice(0, 10);

describe("event outbox", () => {
	let alice: string;
	let bob: string;
	let asAlice: Record<string, string>;
	let asBob: Record<string, string>;

	beforeAll(async () => {
		alice = (await createTestUser()).user.id;
		bob = (await createTestUser()).user.id;
		asAlice = await asMobile(alice);
		asBob = await asMobile(bob);
	});

	/**
	 * The feed holds an event back until every older open transaction on the
	 * Postgres server has ended, and these tests share a server with other
	 * runs, so a read that expects items polls briefly.
	 */
	const feed = async (
		headers: Record<string, string>,
		query = "",
		expectAtLeast = 0,
	) => {
		for (let tries = 0; ; tries++) {
			const page = await expectBody<Feed>(
				await call(`/events${query}`, { headers }),
				contract.events.list,
			);
			if (page.items.length >= expectAtLeast || tries >= 50) return page;
			await new Promise((r) => setTimeout(r, 100));
		}
	};

	describe("the writer", () => {
		it("commits with the write and not before", async () => {
			const user = (await createTestUser()).user.id;
			let beforeCommit = -1;
			await userTransaction(adminDb, user, async (tx) => {
				await appendEvent(tx, {
					type: "expense.created",
					actorUserId: user,
					entityId: "e1",
					data: empty,
				});
				// Another connection cannot see it yet.
				beforeCommit = await adminDb.apiEvent.count({
					where: { userId: user },
				});
			});
			expect(beforeCommit).toBe(0);
			expect(await adminDb.apiEvent.count({ where: { userId: user } })).toBe(1);
		});

		it("leaves no event when the write rolls back", async () => {
			const user = (await createTestUser()).user.id;
			await expect(
				userTransaction(adminDb, user, async (tx) => {
					await appendEvent(tx, {
						type: "expense.created",
						actorUserId: user,
						data: empty,
					});
					throw new Error("the write failed");
				}),
			).rejects.toThrow("the write failed");
			expect(await adminDb.apiEvent.count({ where: { userId: user } })).toBe(0);
		});

		it("refuses text where an id belongs and a name that is not a type", async () => {
			const user = (await createTestUser()).user.id;
			const write = (type: string, ids: Record<string, string>) =>
				userTransaction(adminDb, user, (tx) =>
					appendEvent(tx, {
						type,
						actorUserId: user,
						data: { ids, amounts: [], truncated: false },
					}),
				);
			await expect(
				write("expense.created", { categoryId: "Lunch with Ana" }),
			).rejects.toThrow();
			await expect(write("Expense Created", {})).rejects.toThrow();
			expect(await adminDb.apiEvent.count({ where: { userId: user } })).toBe(0);
		});

		it("keeps the indexes the schema cannot express", async () => {
			const rows = await adminDb.$queryRaw<
				{ indexname: string; indexdef: string }[]
			>`
				SELECT indexname, indexdef FROM pg_indexes
				WHERE tablename IN ('api_event', 'webhook_delivery')`;
			const unfanned = rows.find(
				(r) => r.indexname === "api_event_unfanned_idx",
			);
			expect(unfanned?.indexdef).toContain('"fannedOutAt" IS NULL');
			expect(
				rows.some((r) => r.indexname === "webhook_delivery_eventId_idx"),
			).toBe(true);
		});

		it("lets the app role insert an event only into the actor's own feed", async () => {
			const actor = (await createTestUser()).user.id;
			const other = (await createTestUser()).user.id;
			// The writer has no recipient list; a hand-made row is refused by RLS.
			await expect(
				userTransaction(adminDb, actor, (tx) =>
					tx.apiEvent.create({
						data: {
							userId: other,
							actorUserId: actor,
							type: "payment.recorded",
							payload: empty,
						},
					}),
				),
			).rejects.toThrow();
			expect(await adminDb.apiEvent.count({ where: { userId: other } })).toBe(
				0,
			);
		});

		it("gives the app role no way to change or delete an event", async () => {
			const user = (await createTestUser()).user.id;
			await userTransaction(adminDb, user, (tx) =>
				appendEvent(tx, {
					type: "expense.created",
					actorUserId: user,
					data: empty,
				}),
			);
			await expect(
				userTransaction(adminDb, user, (tx) =>
					tx.apiEvent.deleteMany({ where: { userId: user } }),
				),
			).rejects.toThrow();
			await expect(
				userTransaction(adminDb, user, (tx) =>
					tx.apiEvent.updateMany({
						where: { userId: user },
						data: { type: "x.y" },
					}),
				),
			).rejects.toThrow();
		});
	});

	describe("a mutation outside a v1 route (the web's tRPC)", () => {
		const mutation = (
			id: string,
		): MoneyMutation<{ id: string }, { id: string }> => ({
			id,
			touches: [],
			run: async (_tx, input) => ({
				value: { id: input.id },
				undo: { kind: "revert", mutation: id, rows: [] },
			}),
		});

		it("appends the event the mutation maps to, in its own transaction", async () => {
			const user = (await createTestUser()).user.id;
			await forUser(user).apply(mutation("payment.record"), { id: "pay-1" });
			const rows = await adminDb.apiEvent.findMany({ where: { userId: user } });
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				type: "payment.recorded",
				entityType: "payment",
				entityId: "pay-1",
				actorUserId: user,
			});
		});

		it("appends nothing for a mutation with no event, and nothing for a preview", async () => {
			const user = (await createTestUser()).user.id;
			await forUser(user).apply(mutation("fixRequest.ask"), { id: "f1" });
			await forUser(user).preview(mutation("payment.record"), { id: "pay-2" });
			expect(await adminDb.apiEvent.count({ where: { userId: user } })).toBe(0);
		});

		it("rolls the event back when the mutation fails", async () => {
			const user = (await createTestUser()).user.id;
			const failing: MoneyMutation<{ id: string }, { id: string }> = {
				...mutation("payment.record"),
				run: async () => {
					throw new Error("refused");
				},
			};
			await expect(forUser(user).apply(failing, { id: "x" })).rejects.toThrow();
			expect(await adminDb.apiEvent.count({ where: { userId: user } })).toBe(0);
		});
	});

	describe("GET /events", () => {
		it("needs the read scope", async () => {
			const key = await asKey(alice, ["write:expenses"]);
			await expectProblem(
				await call("/events", { headers: key }),
				403,
				"missing_scope",
			);
			await expectProblem(await call("/events"), 401, "unauthenticated");
		});

		it("shows a v1 write as one event with ids and amounts, never its title", async () => {
			const user = (await createTestUser()).user.id;
			const headers = await asMobile(user);
			const category = await adminDb.category.create({
				data: { userId: user, name: "Food", color: "teal" },
			});
			const res = await call("/expenses", {
				method: "POST",
				headers,
				idempotent: true,
				body: {
					title: "Secret lunch with Ana",
					notes: "she owes me for the wine",
					amount: "12.50",
					currency: "USD",
					date: today(),
					categoryId: category.id,
				},
			});
			const created = await expectBody<{ expense: { id: string } }>(
				res,
				contract.expenses.create,
				201,
			);

			const events = await feed(headers, "", 1);
			expect(events.items).toHaveLength(1);
			const [event] = events.items;
			expect(event).toMatchObject({
				type: "expense.created",
				actorUserId: user,
				entity: { type: "expense", id: created.expense.id },
			});
			expect(event?.data.ids).toMatchObject({ categoryId: category.id });
			expect(JSON.stringify(events)).not.toMatch(/Secret|Ana|wine/);
			// The row in the database is clean too.
			const rows = await adminDb.apiEvent.findMany({ where: { userId: user } });
			expect(
				JSON.stringify(rows, (_k, v) =>
					typeof v === "bigint" ? String(v) : v,
				),
			).not.toMatch(/Secret|Ana|wine/);
		});

		it("appends an event after a write that uses no mutation, without its name", async () => {
			const user = (await createTestUser()).user.id;
			const headers = await asMobile(user);
			const res = await call("/categories", {
				method: "POST",
				headers,
				idempotent: true,
				body: { name: "Private clinic visits", color: "rose" },
			});
			const category = await expectBody<{ id: string }>(
				res,
				contract.categories.create,
				201,
			);
			const events = await feed(headers, "", 1);
			expect(events.items.map((e) => e.type)).toEqual(["category.created"]);
			expect(events.items[0]?.entity).toEqual({
				type: "category",
				id: category.id,
			});
			expect(JSON.stringify(events)).not.toMatch(/Private|clinic/);
		});

		it("writes one event for a replayed request", async () => {
			const user = (await createTestUser()).user.id;
			const headers = await asMobile(user);
			const key = randomUUID();
			for (let i = 0; i < 2; i++)
				await call("/categories", {
					method: "POST",
					headers,
					idempotent: key,
					body: { name: `Replay ${user.slice(0, 4)}`, color: "teal" },
				});
			expect((await feed(headers, "", 1)).items).toHaveLength(1);
		});

		it("writes none for a refused write", async () => {
			const user = (await createTestUser()).user.id;
			const headers = await asMobile(user);
			await call("/categories", {
				method: "POST",
				headers,
				idempotent: true,
				body: { name: "", color: "teal" },
			});
			expect((await feed(headers)).items).toEqual([]);
		});

		it("is private to the caller", async () => {
			const category = await call("/categories", {
				method: "POST",
				headers: asAlice,
				idempotent: true,
				body: { name: `Alice only ${randomUUID().slice(0, 4)}`, color: "teal" },
			});
			expect(category.status).toBe(201);
			expect((await feed(asAlice, "", 1)).items.length).toBeGreaterThan(0);
			const bobs = await feed(asBob);
			expect(bobs.items.every((e) => e.actorUserId !== alice)).toBe(true);
			// A row of Alice's is invisible to Bob even by id.
			const aliceRow = await adminDb.apiEvent.findFirst({
				where: { userId: alice },
			});
			expect(bobs.items.some((e) => e.id === aliceRow?.id)).toBe(false);
		});

		it("pages by cursor in write order and hands back the cursor when nothing is new", async () => {
			const user = (await createTestUser()).user.id;
			const headers = await asMobile(user);
			for (const n of ["one", "two", "three"])
				await call("/categories", {
					method: "POST",
					headers,
					idempotent: true,
					body: { name: `${n} ${user.slice(0, 4)}`, color: "teal" },
				});
			const first = await feed(headers, "?limit=2", 2);
			expect(first.items).toHaveLength(2);
			expect(first.hasMore).toBe(true);
			const second = await feed(headers, `?limit=2&after=${first.cursor}`, 1);
			expect(second.items).toHaveLength(1);
			expect(second.hasMore).toBe(false);
			const ids = [...first.items, ...second.items].map((e) => e.id);
			expect(new Set(ids).size).toBe(3);
			const all = await adminDb.apiEvent.findMany({
				where: { userId: user },
				orderBy: { seq: "asc" },
			});
			expect(ids).toEqual(all.map((r) => r.id));

			const idle = await feed(headers, `?after=${second.cursor}`);
			expect(idle).toEqual({
				items: [],
				cursor: second.cursor,
				hasMore: false,
			});
		});

		it("refuses a cursor that is not ours", async () => {
			await expectProblem(
				await call("/events?after=not-a-cursor", { headers: asAlice }),
				400,
				"bad_request",
			);
		});

		it("never shows a late commit behind a cursor a client already holds", async () => {
			const user = (await createTestUser()).user.id;
			const headers = await asMobile(user);
			const write = (
				tx: Parameters<Parameters<typeof userTransaction>[2]>[0],
				id: string,
			) =>
				appendEvent(tx, {
					type: "expense.created",
					actorUserId: user,
					entityId: id,
					data: empty,
				});

			let release: () => void = () => undefined;
			const gate = new Promise<void>((r) => {
				release = r;
			});
			let opened: () => void = () => undefined;
			const hasOpened = new Promise<void>((r) => {
				opened = r;
			});
			// A starts first and stays open; B starts later and commits first.
			const slow = userTransaction(adminDb, user, async (tx) => {
				await write(tx, "slow");
				opened();
				await gate;
			});
			await hasOpened;
			await userTransaction(adminDb, user, (tx) => write(tx, "fast"));

			// B is committed, but A is still open: nothing is shown, so no cursor
			// can pass A.
			expect((await feed(headers)).items).toEqual([]);

			release();
			await slow;
			const seen = await feed(headers, "", 2);
			expect(seen.items.map((e) => e.entity?.id)).toEqual(["slow", "fast"]);
			// Resuming from the first item still finds the second.
			const resumed = await feed(headers, `?after=${seen.items[0]?.cursor}`, 1);
			expect(resumed.items.map((e) => e.entity?.id)).toEqual(["fast"]);
		});
	});
});
