/**
 * /api/v1/budget money movements on Postgres: assign, move, cover and the
 * undo token, through the same fetch handler the Next route uses. USD book,
 * USD 1,000 to start, so every amount is worked out by hand:
 * To assign 100000, Rent 50000 and Dining 20000 targets.
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
import {
	bookedUser,
	setBudgetFlag,
	usd,
	useBudgetV1,
	uuid,
	withoutStamps,
} from "./fixtures";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.budget;
type Preview = {
	changes: { id: string; delta: { minor: number } }[];
	unchanged: { id: string }[];
	detail?: { kind: string; result: unknown };
};
type Write = { result: Record<string, unknown>; undo: string | null };
type Month = {
	month: { key: number };
	toAssign: { amount: { minor: number } };
	groups: {
		envelopes: { id: string; name: string; left: { minor: number } }[];
	}[];
};

describe("/api/v1/budget movements", () => {
	useApiV1();
	useBudgetV1();
	let as: Record<string, string>;
	let ids: Record<string, string>;
	let monthKey: number;
	let stranger: Record<string, string>;
	let userId: string;

	const post = (path: string, body: unknown, headers = as, key?: string) =>
		call(path, { method: "POST", headers, body, idempotent: key ?? true });
	const month = async () =>
		expectBody<Month>(await call("/budget/month", { headers: as }), c.month);
	const left = async (name: string) =>
		(await month()).groups
			.flatMap((g) => g.envelopes)
			.find((e) => e.name === name)?.left.minor;
	const assignBody = (amountMinor: number, envelope = "Dining") => ({
		batchId: uuid(),
		month: monthKey,
		mode: "add",
		items: [{ id: uuid(), envelopeId: ids[envelope], amountMinor }],
	});

	beforeAll(async () => {
		const s = await bookedUser();
		userId = s.user.id;
		ids = s.ids;
		as = await asMobile(userId);
		stranger = await asMobile((await bookedUser()).user.id);
		monthKey = (await month()).month.key;
	});

	it("answers 403 while the budget flag is off", async () => {
		await setBudgetFlag("OFF");
		try {
			await expectProblem(
				await call("/budget/month", { headers: as }),
				403,
				"forbidden",
			);
		} finally {
			await setBudgetFlag("ALL");
		}
	});

	it("reads the month: To assign and the envelopes' Left", async () => {
		const m = await month();
		expect(m.toAssign.amount).toEqual(usd(100_000));
		expect(await left("Dining")).toBe(0);
	});

	it("previews an assign and writes it with the same answer", async () => {
		const body = assignBody(20_000);
		const preview = await expectBody<Preview>(
			await post("/budget/assign/preview", body, as, "ignored"),
			c.previewAssign,
		);
		expect(
			preview.changes.find((x) => x.id === "budget.notPlannedYet")?.delta,
		).toEqual(usd(-20_000));
		expect(preview.detail?.kind).toBe("envelope.assign");
		// Nothing was written.
		expect(await left("Dining")).toBe(0);

		const written = await expectBody<Write>(
			await post("/budget/assign", body),
			c.assign,
		);
		expect(withoutStamps(written.result)).toEqual(
			withoutStamps(preview.detail?.result),
		);
		expect(await left("Dining")).toBe(20_000);
		expect(written.undo).toEqual(expect.any(String));
	});

	it("replays a write with the same Idempotency-Key", async () => {
		const body = assignBody(1_000);
		const key = uuid();
		const first = await post("/budget/assign", body, as, key);
		const again = await post("/budget/assign", body, as, key);
		expect(first.status).toBe(200);
		expect(JSON.parse(await again.text())).toEqual(
			JSON.parse(await first.text()),
		);
		expect(await left("Dining")).toBe(21_000);
		await expect(
			adminDb.budgetMovement.count({
				where: { batchId: body.batchId },
			}),
		).resolves.toBe(1);
	});

	it("refuses an amount that is not whole minor units (400)", async () => {
		const body = assignBody(10);
		(body.items[0] as { amountMinor: number }).amountMinor = 10.5;
		await expectProblem(
			await post("/budget/assign", body),
			400,
			"validation_failed",
		);
	});

	it("answers 404 for another person's envelope", async () => {
		await expectProblem(
			await post("/budget/assign", assignBody(100), stranger),
			404,
			"not_found",
		);
	});

	it("takes an assign back once, from its token", async () => {
		const written = await expectBody<Write>(
			await post("/budget/assign", assignBody(5_000)),
			c.assign,
		);
		const before = await left("Dining");
		const token = written.undo as string;

		const preview = await expectBody<Preview>(
			await post("/budget/undo/preview", { token }),
			c.previewUndo,
		);
		expect(preview.detail?.kind).toBe("movement.undo");
		expect(await left("Dining")).toBe(before);

		const undone = await expectBody<{ result: { kind: string }; redo: null }>(
			await post("/budget/undo", { token }),
			c.undo,
		);
		expect(undone.result.kind).toBe("movement.undo");
		expect(await left("Dining")).toBe((before ?? 0) - 5_000);

		// The token is spent.
		await expectProblem(await post("/budget/undo", { token }), 409, "conflict");
		// And it is not anyone else's.
		await expectProblem(
			await post("/budget/undo", { token }, stranger),
			400,
			"bad_request",
		);
	});

	it("moves money between envelopes and takes it back", async () => {
		const body = {
			id: uuid(),
			month: monthKey,
			from: ids.Dining,
			to: ids.Rent,
			amountMinor: 2_000,
			kind: "MOVE",
		};
		const diningBefore = await left("Dining");
		const preview = await expectBody<Preview>(
			await post("/budget/move/preview", body),
			c.previewMove,
		);
		expect(preview.detail?.kind).toBe("envelope.move");
		const written = await expectBody<Write>(
			await post("/budget/move", body),
			c.move,
		);
		expect(withoutStamps(written.result)).toEqual(
			withoutStamps(preview.detail?.result),
		);
		expect(await left("Dining")).toBe((diningBefore ?? 0) - 2_000);
		await expectBody(
			await post("/budget/undo", { token: written.undo }),
			c.undo,
		);
		expect(await left("Dining")).toBe(diningBefore);
	});

	it("covers an overspent envelope from To assign", async () => {
		const rent = await left("Rent");
		const body = {
			id: uuid(),
			month: monthKey,
			envelopeId: ids.Rent,
			from: null,
			amountMinor: 1_500,
		};
		const written = await expectBody<Write>(
			await post("/budget/cover", body),
			c.cover,
		);
		expect(await left("Rent")).toBe((rent ?? 0) + 1_500);
		await expectBody(
			await post("/budget/undo", { token: written.undo }),
			c.undo,
		);
		expect(await left("Rent")).toBe(rent);
	});

	it("undoes a movement straight from History", async () => {
		const history = await expectBody<{
			items: { id: string; canUndo: boolean }[];
		}>(
			await call(`/budget/history?envelopeId=${ids.Dining}&limit=5`, {
				headers: as,
			}),
			c.history,
		);
		const target = history.items.find((i) => i.canUndo);
		expect(target).toBeTruthy();
		const before = await left("Dining");
		await expectBody(
			await post("/budget/movements/undo", {
				id: uuid(),
				target: { movementId: target?.id },
			}),
			c.undoMovement,
		);
		expect(await left("Dining")).not.toBe(before);
	});

	it("starts fresh: takes every envelope's money back, and the token gives it again", async () => {
		await expectBody(
			await post("/budget/assign", assignBody(7_000, "Rent")),
			c.assign,
		);
		const before = { rent: await left("Rent"), dining: await left("Dining") };
		const body = { batchId: uuid() };
		const preview = await expectBody<Preview>(
			await post("/budget/reset/preview", body),
			c.previewReset,
		);
		expect(preview.detail?.kind).toBe("envelope.reset");
		const written = await expectBody<Write>(
			await post("/budget/reset", body),
			c.reset,
		);
		// The engine makes the ids of a reset's rows, so a dry run and the write differ there.
		const rows = (r: unknown) =>
			(r as { movements: { id: string; createdAt: string }[] }).movements.map(
				({ id: _id, createdAt: _at, ...rest }) => rest,
			);
		expect(rows(written.result)).toEqual(rows(preview.detail?.result));
		expect(await left("Rent")).toBe(0);
		expect(await left("Dining")).toBe(0);
		expect((await month()).toAssign.amount).toEqual(usd(100_000));

		await expectBody(
			await post("/budget/undo", { token: written.undo }),
			c.undo,
		);
		expect(await left("Rent")).toBe(before.rent);
		expect(await left("Dining")).toBe(before.dining);
	});

	it("fixes nothing when To assign is not negative, and carries only a real overspend", async () => {
		await expectProblem(
			await post("/budget/fix-negative", { batchId: uuid() }),
			400,
			"bad_request",
		);
		await expectProblem(
			await post("/budget/carry-overspend", {
				id: uuid(),
				envelopeId: ids.Dining,
				amountMinor: 500,
			}),
			400,
			"bad_request",
		);
	});

	it("reads a month's summary: null until it closes", async () => {
		const summary = await expectBody(
			await call(`/budget/month-summary?month=${monthKey}`, { headers: as }),
			c.monthSummary,
		);
		expect(summary).toBeNull();
	});
});
