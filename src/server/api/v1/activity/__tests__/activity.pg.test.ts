/**
 * /api/v1 activity on Postgres: a project's feed (paged and filtered), its
 * filter lists, the latest entry per project, an expense's revision history
 * (still readable once deleted), edit counts and the seen mark, each with
 * the web's membership rules. Sofia and Martin share "Trip"; a stranger
 * sees none of it.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import {
	arsUser,
	seedRates,
	type TestUser,
} from "../../__tests__/g3-fixtures";
import {
	asMobile,
	call,
	expectBody,
	expectProblem,
	useApiV1,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.activity;
type Entry = {
	id: string;
	action: { type: string };
	actor: { name: string };
	summary: string;
	summaryKey?: string | null;
	params?: Record<string, string> | null;
	amounts?: Record<string, { minor: number; currency: string }>;
	changes: Record<string, unknown> | null;
};
type Page = { items: Entry[]; nextCursor: string | null; totalCount: number };

describe("/api/v1 activity", () => {
	useApiV1();
	let sofia: TestUser;
	let martin: TestUser;
	let stranger: TestUser;
	let asSofia: Record<string, string>;
	let asMartin: Record<string, string>;
	let asStranger: Record<string, string>;
	let trip: string;
	let dinner: string;

	const send = (
		method: string,
		path: string,
		headers: Record<string, string>,
		body?: unknown,
	) => call(path, { method, headers, body, idempotent: true });

	const expense = (amount: string) => ({
		amount,
		currency: "ARS",
		description: "Dinner",
		date: "2026-10-10",
		paidBy: { type: "user", id: sofia.user.id },
		splitWith: [
			{ type: "user", id: sofia.user.id },
			{ type: "user", id: martin.user.id },
		],
		splitMode: "EQUAL",
		projectId: trip,
	});

	beforeAll(async () => {
		await seedRates();
		[sofia, martin, stranger] = [await arsUser(), await arsUser(), await arsUser()];
		[asSofia, asMartin, asStranger] = [
			await asMobile(sofia.user.id),
			await asMobile(martin.user.id),
			await asMobile(stranger.user.id),
		];
		trip = (
			await (
				await send("POST", "/projects", asSofia, {
					id: randomUUID(),
					name: "Trip",
					primaryCurrency: "ARS",
				})
			).json()
		).id;
		await send("POST", `/projects/${trip}/members`, asSofia, {
			person: { type: "user", id: martin.user.id },
			role: "EDITOR",
		});
		const made = await send("POST", "/shared-expenses", asSofia, expense("1000"));
		dinner = (await made.json()).id;
		await send("PUT", `/shared-expenses/${dinner}`, asSofia, {
			id: dinner,
			...expense("1200"),
		});
	});

	it("pages the feed newest first, and only for members", async () => {
		const first = await expectBody<Page>(
			await call(`/projects/${trip}/activity?limit=2`, { headers: asMartin }),
			c.feed,
		);
		expect(first.items).toHaveLength(2);
		expect(first.totalCount).toBeGreaterThanOrEqual(4);
		expect(first.nextCursor).not.toBeNull();
		const second = await expectBody<Page>(
			await call(
				`/projects/${trip}/activity?limit=100&cursor=${first.nextCursor}`,
				{ headers: asMartin },
			),
			c.feed,
		);
		const ids = [...first.items, ...second.items].map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(first.items[0]?.summary).toBeTruthy();
		await expectProblem(
			await call(`/projects/${trip}/activity`, { headers: asStranger }),
			404,
			"not_found",
		);
	});

	it("gives facts to word, not formatted text: a key, raw parts and Money", async () => {
		const edits = await expectBody<Page>(
			await call(`/projects/${trip}/activity?actions=EDITED`, {
				headers: asSofia,
			}),
			c.feed,
		);
		const amountEdit = edits.items.find(
			(e) => e.summaryKey?.startsWith("activityEditedAmount"),
		);
		expect(amountEdit?.amounts).toEqual({
			from: { minor: 100_000, currency: "ARS" },
			to: { minor: 120_000, currency: "ARS" },
		});
		// The title is whole and unquoted; the amounts are not in the text params.
		expect(amountEdit?.params).toEqual({
			actor: expect.any(String),
			description: "Dinner",
		});
		expect(amountEdit?.changes).toMatchObject({ amount: { old: 1000, new: 1200 } });
	});

	it("filters by action and by who acted, and refuses what it does not know", async () => {
		const edits = await expectBody<Page>(
			await call(`/projects/${trip}/activity?actions=EDITED`, {
				headers: asSofia,
			}),
			c.feed,
		);
		expect(edits.items.length).toBeGreaterThan(0);
		expect(edits.items.every((e) => e.action.type === "edited")).toBe(true);
		const mine = await expectBody<Page>(
			await call(
				`/projects/${trip}/activity?actorType=user&actorId=${martin.user.id}`,
				{ headers: asSofia },
			),
			c.feed,
		);
		expect(mine.totalCount).toBe(0);
		await expectProblem(
			await call(`/projects/${trip}/activity?actions=NOPE`, { headers: asSofia }),
			400,
			"bad_request",
		);
		await expectProblem(
			await call(`/projects/${trip}/activity?actorType=user`, { headers: asSofia }),
			400,
			"bad_request",
		);
	});

	it("lists who acted and what kinds of change there were", async () => {
		const filters = await expectBody<{
			actors: { id: string; name: string }[];
			actionTypes: { value: string; count: number }[];
		}>(
			await call(`/projects/${trip}/activity/filters`, { headers: asMartin }),
			c.filters,
		);
		expect(filters.actors.map((a) => a.id)).toContain(sofia.user.id);
		expect(filters.actionTypes.map((a) => a.value)).toEqual(
			expect.arrayContaining(["CREATED", "EDITED"]),
		);
	});

	it("gives the latest entry of your projects and leaves the others out", async () => {
		const other = (
			await (
				await send("POST", "/projects", asStranger, {
					name: "Private",
					primaryCurrency: "ARS",
				})
			).json()
		).id;
		const last = await expectBody<{ items: { projectId: string; entry: Entry }[] }>(
			await call(`/projects/last-activity?ids=${trip},${other}`, {
				headers: asSofia,
			}),
			c.lastActivity,
		);
		expect(last.items.map((i) => i.projectId)).toEqual([trip]);
	});

	it("reads an expense's revisions, still after it is deleted, for people on it", async () => {
		const history = async (headers = asMartin) =>
			expectBody<{
				expense: { title: string; amount: { minor: number } | null; isDeleted: boolean };
				entries: Entry[];
				totalEntries: number;
			}>(await call(`/shared-expenses/${dinner}/history`, { headers }), c.history);
		const live = await history();
		expect(live.expense).toMatchObject({
			title: "Dinner",
			amount: { minor: 120_000 },
			isDeleted: false,
		});
		expect(live.entries.map((e) => e.action.type)).toEqual(
			expect.arrayContaining(["created", "edited"]),
		);
		// The stored change record, not a formatted one: amounts as numbers.
		expect(
			live.entries.find((e) => e.action.type === "edited")?.changes,
		).toMatchObject({ amount: { old: 1000, new: 1200 } });
		await expectProblem(
			await call(`/shared-expenses/${dinner}/history`, { headers: asStranger }),
			403,
			"forbidden",
		);

		const revisions = await expectBody<{
			items: { expenseId: string; editCount: number; lastEditedBy: string | null }[];
		}>(
			await call(`/shared-expenses/revisions?ids=${dinner},nope`, {
				headers: asMartin,
			}),
			c.revisions,
		);
		expect(revisions.items).toMatchObject([{ expenseId: dinner, editCount: 1 }]);

		await send("DELETE", `/shared-expenses/${dinner}`, asSofia, {
			id: dinner,
			confirmUnsettled: true,
		});
		const gone = await history(asSofia);
		expect(gone.expense).toMatchObject({ isDeleted: true, amount: null });
		expect(gone.entries.map((e) => e.action.type)).toContain("deleted");
	});

	it("marks changes as seen, for yourself", async () => {
		const made = await send("POST", "/shared-expenses", asSofia, expense("500"));
		const id = (await made.json()).id as string;
		const unseen = (userId: string) =>
			adminDb.splitParticipant.findFirstOrThrow({
				where: { transactionId: id, participantId: userId },
			});
		await adminDb.splitParticipant.updateMany({
			where: { transactionId: id },
			data: { hasUnseenChanges: true },
		});
		await expectBody(
			await send("POST", `/shared-expenses/${id}/seen`, asMartin, {}),
			c.markSeen,
		);
		expect((await unseen(martin.user.id)).hasUnseenChanges).toBe(false);
		expect((await unseen(sofia.user.id)).hasUnseenChanges).toBe(true);
	});
});
