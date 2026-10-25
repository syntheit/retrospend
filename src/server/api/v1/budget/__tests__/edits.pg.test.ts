/**
 * /api/v1/budget envelope edits, styles, periods, the bank check and plans
 * on Postgres: every write has a preview that equals its result, an undo
 * token that works once, and a stale token answers 409.
 */
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import {
	asMobile,
	call,
	expectBody,
	expectProblem,
	useApiV1,
} from "../../core/__tests__/harness";
import { bookedUser, toV1, useBudgetV1, uuid, withoutStamps } from "./fixtures";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.budget;
type Preview = {
	changes: { id: string; delta: { minor: number } }[];
	detail?: { kind: string; result: unknown };
};
type Write = { result: Record<string, unknown>; undo: string | null };
type Month = {
	month: { key: number };
	book: { style: string };
	groups: {
		id: string | null;
		role: string | null;
		envelopes: { id: string; name: string; left: { minor: number } }[];
	}[];
};
type Route = { "~orpc": { outputSchema?: unknown } };

describe("/api/v1/budget edits", () => {
	useApiV1();
	useBudgetV1();
	let as: Record<string, string>;
	let ids: Record<string, string>;
	let userId: string;
	let spendingGroup: string;
	let nextMonth: number;
	let stranger: Record<string, string>;

	const send = (method: string, path: string, body?: unknown, headers = as) =>
		call(path, {
			method,
			headers,
			body: toV1(body),
			idempotent: method !== "GET",
		});
	const month = async () =>
		expectBody<Month>(await call("/budget/month", { headers: as }), c.month);
	const names = async () =>
		(await month()).groups.flatMap((g) => g.envelopes.map((e) => e.name));
	const undo = (token: string | null, headers = as) =>
		send("POST", "/budget/undo", { token }, headers);

	/** The preview, then the write: the two answer alike. */
	async function twin(
		path: string,
		body: unknown,
		routes: { write: Route; preview: Route },
		opts: { method?: string; status?: number } = {},
	) {
		const preview = await expectBody<Preview>(
			await send("POST", `${path}/preview`, body),
			routes.preview,
		);
		const written = await expectBody<Write>(
			await send(opts.method ?? "POST", path, body),
			routes.write,
			opts.status ?? 200,
		);
		expect(withoutStamps(written.result)).toEqual(
			withoutStamps(preview.detail?.result),
		);
		return { preview, written };
	}

	beforeAll(async () => {
		const s = await bookedUser();
		userId = s.user.id;
		ids = s.ids;
		as = await asMobile(userId);
		stranger = await asMobile((await bookedUser()).user.id);
		const m = await month();
		spendingGroup = m.groups.find((g) => g.role === "SPENDING")?.id as string;
		nextMonth = m.month.key % 100 === 12 ? m.month.key + 89 : m.month.key + 1;
	});

	it("creates an envelope; its token deletes it, once", async () => {
		const body = {
			id: uuid(),
			name: "Gym",
			groupId: spendingGroup,
			kind: "MONTHLY",
			target: { kind: "MONTHLY", amountMinor: 3_000 },
			categoryIds: [],
		};
		const preview = await expectBody<Preview>(
			await send("POST", "/budget/envelopes/preview", body),
			c.previewCreateEnvelope,
		);
		expect(await names()).not.toContain("Gym");
		const written = await expectBody<Write>(
			await send("POST", "/budget/envelopes", body),
			c.createEnvelope,
			201,
		);
		expect(withoutStamps(written.result)).toEqual(
			withoutStamps(preview.detail?.result),
		);
		expect(await names()).toContain("Gym");

		await expectBody(await undo(written.undo), c.undo);
		expect(await names()).not.toContain("Gym");
		await expectProblem(await undo(written.undo), 409, "conflict");
	});

	it("refuses an undo once a newer edit of the envelope exists (409)", async () => {
		const create = await expectBody<Write>(
			await send("POST", "/budget/envelopes", {
				id: uuid(),
				name: "Books",
				groupId: spendingGroup,
				kind: "NONE",
				categoryIds: [],
			}),
			c.createEnvelope,
			201,
		);
		const envelopeId = create.result.envelopeId as string;
		const rename = await twin(
			`/budget/envelopes/${envelopeId}`,
			{ id: uuid(), envelopeId, name: "Reading" },
			{ write: c.updateEnvelope, preview: c.previewUpdateEnvelope },
			{ method: "PATCH" },
		);
		expect(await names()).toContain("Reading");

		await expectProblem(await undo(create.undo), 409, "conflict");
		await expectBody(await undo(rename.written.undo), c.undo);
		expect(await names()).toContain("Books");
		await expectBody(await undo(create.undo), c.undo);
		expect(await names()).not.toContain("Books");
	});

	it("sets a target, archives and combines envelopes", async () => {
		const target = await twin(
			`/budget/envelopes/${ids.Dining}/target`,
			{
				id: uuid(),
				envelopeId: ids.Dining,
				kind: "MONTHLY",
				target: { kind: "MONTHLY", amountMinor: 25_000 },
			},
			{ write: c.setTarget, preview: c.previewSetTarget },
		);
		await expectBody(await undo(target.written.undo), c.undo);

		const a = uuid();
		const b = uuid();
		for (const [id, name] of [
			[a, "Tea"],
			[b, "Coffee"],
		] as const)
			await expectBody(
				await send("POST", "/budget/envelopes", {
					id,
					name,
					groupId: spendingGroup,
					kind: "NONE",
					categoryIds: [],
				}),
				c.createEnvelope,
				201,
			);
		const merged = await twin(
			"/budget/merge-envelopes",
			{ id: uuid(), intoId: a, fromIds: [b], name: "Hot drinks" },
			{ write: c.mergeEnvelopes, preview: c.previewMergeEnvelopes },
		);
		expect(await names()).toContain("Hot drinks");
		expect(await names()).not.toContain("Coffee");
		await expectBody(await undo(merged.written.undo), c.undo);
		expect(await names()).toContain("Coffee");

		const archived = await twin(
			`/budget/envelopes/${a}/archive`,
			{ id: uuid(), envelopeId: a },
			{ write: c.archiveEnvelope, preview: c.previewArchiveEnvelope },
		);
		expect(await names()).not.toContain("Tea");
		await expectBody(await undo(archived.written.undo), c.undo);
		expect(await names()).toContain("Tea");
	});

	it("another person's envelope is a 404", async () => {
		await expectProblem(
			await send(
				"POST",
				`/budget/envelopes/${ids.Dining}/archive`,
				{ id: uuid(), envelopeId: ids.Dining },
				stranger,
			),
			404,
			"not_found",
		);
	});

	it("switches the style and refuses a stale undo", async () => {
		const first = await twin(
			"/budget/style",
			{ id: uuid(), style: "EVERY_DOLLAR" },
			{ write: c.setStyle, preview: c.previewSetStyle },
		);
		expect((await month()).book.style).toBe("EVERY_DOLLAR");
		const second = await twin(
			"/budget/style",
			{ id: uuid(), style: "FLEX" },
			{ write: c.setStyle, preview: c.previewSetStyle },
		);
		await expectProblem(await undo(first.written.undo), 409, "conflict");
		await expectBody(await undo(second.written.undo), c.undo);
		expect((await month()).book.style).toBe("EVERY_DOLLAR");
	});

	it("moves the day a month starts and puts it back", async () => {
		const set = await twin(
			"/budget/period",
			{ startDay: 5 },
			{ write: c.setPeriod, preview: c.previewSetPeriod },
		);
		expect(set.written.undo).toEqual(expect.any(String));
		await expectBody(await undo(set.written.undo), c.undo);
		await expectProblem(await undo(set.written.undo), 409, "conflict");
	});

	it("records the bank's difference as an Adjustment and removes it", async () => {
		const bank = await expectBody<{ difference: { minor: number } }>(
			await call("/budget/bank-check", { headers: as }),
			c.bankCheck,
		);
		const rec = await twin(
			"/budget/reconcile",
			{ id: uuid(), bankMinor: 123_456 },
			{ write: c.reconcile, preview: c.previewReconcile },
		);
		expect(rec.written.result.expenseId).toEqual(expect.any(String));
		expect(bank.difference).toBeTruthy();
		await expectBody(await undo(rec.written.undo), c.undo);
		await expect(
			adminDb.expense.count({
				where: { id: rec.written.result.expenseId as string },
			}),
		).resolves.toBe(0);
	});

	it("keeps income rules in order, with no money moved", async () => {
		const rule = await expectBody<{ id: string }>(
			await send("POST", "/budget/rules", {
				id: uuid(),
				name: "Save a fifth",
				match: { kind: "ANY" },
				action: { kind: "PERCENT", basisPoints: 2_000 },
				envelopeId: ids.Rent,
			}),
			c.createRule,
			201,
		);
		const renamed = await expectBody<{ name: string }>(
			await send("PATCH", `/budget/rules/${rule.id}`, {
				id: rule.id,
				name: "Save 20%",
			}),
			c.updateRule,
		);
		expect(renamed.name).toBe("Save 20%");
		const list = await expectBody<{ id: string }[]>(
			await call("/budget/rules", { headers: as }),
			c.rules,
		);
		expect(list.map((r) => r.id)).toContain(rule.id);
		await expectBody(
			await send("POST", "/budget/rules/reorder", { ids: [rule.id] }),
			c.reorderRules,
		);
		await expectBody(
			await send("DELETE", `/budget/rules/${rule.id}`),
			c.archiveRule,
		);
		await expectProblem(
			await send(
				"PATCH",
				`/budget/rules/${rule.id}`,
				{ id: rule.id },
				stranger,
			),
			404,
			"not_found",
		);
	});

	it("saves a plan, applies it and takes it back", async () => {
		const draftId = uuid();
		const saved = await expectBody<{ id: string; status: string }>(
			await send("POST", "/budget/drafts", {
				id: draftId,
				kind: "PLAN",
				month: nextMonth,
				lines: [{ envelopeId: ids.Dining, amountMinor: 15_000 }],
			}),
			c.saveDraft,
		);
		expect(saved.status).toBe("OPEN");
		const outcome = await expectBody<{ draftId: string }>(
			await call(`/budget/drafts/${draftId}/outcome`, { headers: as }),
			c.draftOutcome,
		);
		expect(outcome.draftId).toBe(draftId);

		const applied = await twin(
			`/budget/drafts/${draftId}/apply`,
			{ draftId },
			{ write: c.applyDraft, preview: c.previewApplyDraft },
		);
		await expectBody(await undo(applied.written.undo), c.undo);
		await expectProblem(await undo(applied.written.undo), 409, "conflict");
		await expectBody(
			await send("POST", `/budget/drafts/${draftId}/discard`, {
				draftId,
			}),
			c.discardDraft,
		);
	});

	it("sets a group's target with a preview and takes it back; stale tokens answer 409", async () => {
		const path = `/budget/groups/${spendingGroup}/target`;
		const first = await twin(
			path,
			{
				groupId: spendingGroup,
				target: { kind: "AMOUNT", amountMinor: 40_000 },
			},
			{ write: c.setGroupTarget, preview: c.previewSetGroupTarget },
			{ method: "PUT" },
		);
		expect(first.written.result.groupId).toBe(spendingGroup);
		const second = await twin(
			path,
			{
				groupId: spendingGroup,
				target: { kind: "AMOUNT", amountMinor: 45_000 },
			},
			{ write: c.setGroupTarget, preview: c.previewSetGroupTarget },
			{ method: "PUT" },
		);
		await expectProblem(await undo(first.written.undo), 409, "conflict");
		const undone = await expectBody<{
			result: { kind: string; result: unknown };
		}>(await undo(second.written.undo), c.undo);
		expect(undone.result.kind).toBe("group_target.set");
		expect(undone.result.result).toMatchObject({
			target: { kind: "AMOUNT", amount: "400.00" },
		});
		await expectProblem(await undo(second.written.undo), 409, "conflict");
	});

	it("pauses and resumes the budget", async () => {
		const paused = await expectBody<{ paused: boolean }>(
			await send("POST", "/budget/pause", {}),
			c.pause,
		);
		expect(paused.paused).toBe(true);
		const back = await expectBody<{ paused: boolean }>(
			await send("POST", "/budget/resume", {}),
			c.resume,
		);
		expect(back.paused).toBe(false);
	});

	it("reads the rest of the month's numbers", async () => {
		for (const [path, route] of [
			["/budget/verdict", c.verdict],
			["/budget/left-to-spend", c.leftToSpend],
			["/budget/fill-from-targets", c.fillFromTargets],
			[`/budget/cover-sources?envelopeId=${ids.Rent}`, c.coverSources],
			["/budget/owed", c.owed],
			["/budget/welcome-back", c.welcomeBackState],
			["/budget/afford?amount=50.00", c.afford],
			["/budget/unrouted-shares", c.unroutedShares],
			["/budget/plan-fill?source=TARGETS", c.planFill],
			["/budget/plan-cost", c.planCost],
			["/budget/year", c.year],
			["/budget/payoff-plan", c.payoffPlan],
			["/budget/payoff-projection", c.payoffProjection],
			["/budget/migration", c.migration],
			["/budget/hidden-rows", c.hiddenRows],
			["/budget/export", c.export],
			["/budget/pacing", c.pacing],
			["/budget/setup-preset?style=FLEX", c.setupPreset],
		] as const) {
			const res = await call(path, { headers: as });
			if (path.includes("setup-preset")) {
				// A person with a book cannot start another.
				await expectProblem(res, 409, "conflict");
				continue;
			}
			await expectBody(res, route as Route);
		}
	});
});
