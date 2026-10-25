/**
 * /api/v1/budget hidden rows, the move from the old budget and the export on
 * Postgres. The fixture is the web's own (legacy-migrate.pg.test.ts): Dining
 * 200.00 and Rent 500.00 limits, 150.00 spent on Dining and 60.00 more that
 * the old budget hid from reports.
 */
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addRow } from "~/server/services/envelope/__tests__/pg-fixture";
import { migrateUsers } from "~/server/services/envelope/legacy-migrate.batch";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import {
	call,
	expectBody,
	expectProblem,
	useApiV1,
} from "../../core/__tests__/harness";
import { mobileFrom, toV1, useBudgetV1, withoutStamps } from "./fixtures";

const asMobile = mobileFrom("198.51.100.86");

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.budget;
type Write = { result: Record<string, unknown>; undo: string | null };
type Preview = { detail?: { kind: string; result: unknown } };

const month = () => {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), 1);
};

describe("/api/v1/budget migration", () => {
	useApiV1();
	useBudgetV1();
	let as: Record<string, string>;
	let stranger: Record<string, string>;
	let hidden: string;
	let userId: string;

	const post = (path: string, body: unknown, headers = as) =>
		call(path, { method: "POST", headers, body: toV1(body), idempotent: true });
	const undo = (token: string | null) => post("/budget/undo", { token });
	const dining = async () =>
		(
			await expectBody<{
				groups: { envelopes: { name: string; left: { minor: number } }[] }[];
			}>(await call("/budget/month", { headers: as }), c.month)
		).groups
			.flatMap((g) => g.envelopes)
			.find((e) => e.name === "Dining")?.left.minor;

	beforeAll(async () => {
		const t = await createTestUser();
		userId = t.user.id;
		await adminDb.user.update({
			where: { id: userId },
			data: { homeCurrency: "USD", timeZone: "UTC", fiscalMonthStartDay: 1 },
		});
		const cat = (name: string, isFixed = false) =>
			adminDb.category
				.create({ data: { name, color: "blue", isFixed, userId } })
				.then((x) => x.id);
		const diningId = await cat("Dining");
		const rentId = await cat("Rent", true);
		for (const [categoryId, amount] of [
			[diningId, "200.00"],
			[rentId, "500.00"],
		] as const)
			await adminDb.budget.create({
				data: {
					userId,
					categoryId,
					amount: new Prisma.Decimal(amount),
					currency: "USD",
					type: "FIXED",
					period: month(),
				},
			});
		await addRow(userId, { amount: 150, categoryId: diningId });
		hidden = (
			await addRow(userId, {
				amount: 60,
				categoryId: diningId,
				excludeFromAnalytics: true,
			})
		).id;
		await migrateUsers(adminDb, {
			apply: true,
			userIds: [userId],
			runId: `test-${userId}`,
		});
		as = await asMobile(userId);
		stranger = await asMobile((await createTestUser()).user.id);
	});

	it("reports the move, lists the hidden row and dismisses the notice", async () => {
		const state = await expectBody<{
			migrated: boolean;
			noticeOpen: boolean;
			hiddenRows: number;
		}>(await call("/budget/migration", { headers: as }), c.migration);
		expect(state).toEqual({ migrated: true, noticeOpen: true, hiddenRows: 1 });
		const rows = await expectBody<{ rows: { id: string }[] }>(
			await call("/budget/hidden-rows", { headers: as }),
			c.hiddenRows,
		);
		expect(rows.rows.map((r) => r.id)).toEqual([hidden]);

		const closed = await expectBody<{ noticeOpen: boolean }>(
			await post("/budget/migration/dismiss", {}),
			c.dismissMigrationNotice,
		);
		expect(closed.noticeOpen).toBe(false);
	});

	it("answers Not spending with a preview, and takes the answer back from its token", async () => {
		expect(await dining()).toBe(-1_000);
		const body = { answers: [{ id: hidden, answer: "NOT_SPENDING" }] };
		const preview = await expectBody<Preview>(
			await post("/budget/hidden-rows/resolve/preview", body),
			c.previewResolveHidden,
		);
		expect(await dining()).toBe(-1_000);
		const written = await expectBody<Write>(
			await post("/budget/hidden-rows/resolve", body),
			c.resolveHidden,
		);
		expect(withoutStamps(written.result)).toEqual(
			withoutStamps(preview.detail?.result),
		);
		expect(await dining()).toBe(5_000);

		const undone = await expectBody<{ result: { kind: string } }>(
			await undo(written.undo),
			c.undo,
		);
		expect(undone.result.kind).toBe("hidden_rows.revert");
		expect(await dining()).toBe(-1_000);
		await expectProblem(await undo(written.undo), 409, "conflict");
	});

	it("refuses an undo once the row was edited since (409)", async () => {
		const written = await expectBody<Write>(
			await post("/budget/hidden-rows/resolve", {
				answers: [{ id: hidden, answer: "SPENDING" }],
			}),
			c.resolveHidden,
		);
		await adminDb.expense.update({
			where: { id: hidden },
			data: { title: "Edited" },
		});
		await expectProblem(await undo(written.undo), 409, "conflict");
	});

	it("exports the budget as files", async () => {
		const out = await expectBody<{
			files: { name: string }[];
			filename: string;
		}>(await call("/budget/export", { headers: as }), c.export);
		expect(out.files.length).toBeGreaterThan(0);
		expect(out.filename).toMatch(/^retrospend-budget-/);
	});

	it("shows nothing of another person's move", async () => {
		const rows = await expectBody<{ rows: unknown[] }>(
			await call("/budget/hidden-rows", { headers: stranger }),
			c.hiddenRows,
		);
		expect(rows.rows).toEqual([]);
		await expectProblem(
			await post(
				"/budget/hidden-rows/resolve",
				{
					answers: [{ id: hidden, answer: "SPENDING" }],
				},
				stranger,
			),
			404,
			"not_found",
		);
	});
});
