/**
 * /api/v1/income on Postgres: Add income into an account, with Use my plan
 * and Repeats, previews equal results, undo and redo, idempotent replay, and
 * cross-user 404. ARS home user, one Savings account.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	arsUser,
	balanceOf,
	openAccount,
	seedArsRates,
} from "~/server/services/accounts/test-fixtures";
import { setupInput } from "~/server/services/envelope/__tests__/pg-fixture";
import { setupEnvelopeBook } from "~/server/services/envelope/setup.mutation";
import { forUser } from "~/server/services/preview";
import {
	adminDb,
	asKey,
	asMobile,
	call,
	expectBody,
	expectProblem,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.income;
type Money = { minor: number; currency: string };
type Write = {
	income: {
		id: string;
		booked: Money | null;
		account: { before: Money; after: Money } | null;
		kept: boolean;
		templateId: string | null;
		plan: { applied: boolean; reason: string | null };
	};
	undo: string;
};
type Preview = {
	changes: { id: string; delta: Money }[];
	detail?: { kind: string; plan?: { applied: boolean; reason: string | null } };
};

type PlanBody = {
	applied: boolean;
	batchId: string | null;
	lines: unknown[];
	rest: Money | null;
};
type PlanPreview = { detail?: { plan?: PlanBody } };
type PlanWrite = { income: { plan: PlanBody } };

describe("/api/v1/income", () => {
	let userId: string;
	let otherId: string;
	let savings: string;
	let as: Record<string, string>;
	let asOther: Record<string, string>;

	beforeAll(async () => {
		await seedArsRates();
		userId = (await arsUser()).user.id;
		otherId = (await arsUser()).user.id;
		savings = await openAccount(userId, "Savings", "CASH", "ARS", 1000);
		as = await asMobile(userId);
		asOther = await asMobile(otherId);
	});

	const input = (extra: Record<string, unknown> = {}) => ({
		title: "Salary",
		amount: "500",
		currency: "ARS",
		into: savings,
		...extra,
	});
	const post = (path: string, body: unknown, headers = as, key?: string) =>
		call(path, { method: "POST", headers, body, idempotent: key ?? true });

	it("adds income into an account and returns the balance change", async () => {
		const made = await expectBody<Write>(
			await post("/income", input()),
			c.create,
			201,
		);
		expect(made.income).toMatchObject({
			booked: { minor: 50_000, currency: "ARS" },
			account: {
				before: { minor: 100_000, currency: "ARS" },
				after: { minor: 150_000, currency: "ARS" },
			},
			templateId: null,
		});
		expect(await balanceOf(savings)).toBe("1500");
		// Use my plan was not asked for.
		expect(made.income.plan).toMatchObject({
			applied: false,
			reason: "not_requested",
		});
	});

	it("previews the same write without booking it", async () => {
		const before = await balanceOf(savings);
		const rows = await adminDb.expense.count({ where: { userId } });
		const preview = await expectBody<Preview>(
			await post("/income/preview", input({ title: "Bonus", amount: "300" })),
			c.previewCreate,
		);
		expect(await balanceOf(savings)).toBe(before);
		expect(await adminDb.expense.count({ where: { userId } })).toBe(rows);
		const worth = preview.changes.find((x) => x.id === "netWorth");
		expect(worth?.delta).toEqual({ minor: 30_000, currency: "ARS" });

		const made = await expectBody<Write>(
			await post("/income", input({ title: "Bonus", amount: "300" })),
			c.create,
			201,
		);
		expect(made.income.account?.after.minor).toBe(
			(made.income.account?.before.minor ?? 0) + 30_000,
		);
	});

	it("previews the plan the write would run", async () => {
		const asked = await expectBody<Preview>(
			await post("/income/preview", input({ title: "Planned", usePlan: true })),
			c.previewCreate,
		);
		expect(asked.detail).toMatchObject({
			kind: "income.add",
			plan: { applied: false, reason: "no_envelope_budget" },
		});
		const plain = await expectBody<Preview>(
			await post("/income/preview", input({ title: "Plain" })),
			c.previewCreate,
		);
		expect(plain.detail?.plan).toMatchObject({ reason: "not_requested" });
	});

	it("previews an applied plan equal to the write's, with no batch id", async () => {
		const planned = (await arsUser()).user.id;
		const wallet = await openAccount(planned, "Wallet", "CASH", "ARS", 0);
		const category = (name: string) =>
			adminDb.category
				.create({ data: { name, color: "blue", userId: planned } })
				.then((made) => made.id);
		await forUser(planned).apply(setupEnvelopeBook, {
			...setupInput({
				rent: await category("Rent"),
				dining: await category("Dining"),
			}),
			timeZone: "UTC",
		});
		const body = {
			title: "Salary",
			amount: "1000",
			currency: "ARS",
			into: wallet,
			usePlan: true,
		};
		const headers = await asMobile(planned);
		const preview = await expectBody<PlanPreview>(
			await post("/income/preview", body, headers),
			c.previewCreate,
		);
		expect(preview.detail?.plan?.applied).toBe(true);
		expect(preview.detail?.plan?.lines.length).toBeGreaterThan(0);
		// A rolled-back id names nothing a client could undo.
		expect(preview.detail?.plan?.batchId).toBeNull();

		const made = await expectBody<PlanWrite>(
			await post("/income", body, headers),
			c.create,
			201,
		);
		expect(made.income.plan.batchId).toEqual(expect.any(String));
		expect(preview.detail?.plan?.lines).toEqual(made.income.plan.lines);
		expect(preview.detail?.plan?.rest).toEqual(made.income.plan.rest);
	});

	it("says when Use my plan could not run, without failing the write", async () => {
		const made = await expectBody<Write>(
			await post("/income", input({ title: "Planned", usePlan: true })),
			c.create,
			201,
		);
		expect(made.income.plan).toMatchObject({
			applied: false,
			reason: "no_envelope_budget",
		});
	});

	it("replays a create with the same key and books it once", async () => {
		const key = randomUUID();
		const data = input({ title: "Once only" });
		const first = await post("/income", data, as, key);
		const second = await post("/income", data, as, key);
		expect(second.headers.get("idempotent-replayed")).toBe("true");
		expect(await second.json()).toEqual(await first.json());
		await expect(
			adminDb.expense.count({ where: { userId, title: "Once only" } }),
		).resolves.toBe(1);
	});

	it("undoes an income and redoes it, with the same entry id back", async () => {
		const made = await expectBody<Write>(
			await post("/income", input({ title: "Undo me", amount: "100" })),
			c.create,
			201,
		);
		const id = made.income.id;
		const after = await balanceOf(savings);

		const undone = await expectBody<{
			id: string;
			accounts: { before: Money; after: Money }[];
			redo: string;
		}>(await post("/income/undo", { token: made.undo }), c.undo);
		expect(undone.id).toBe(id);
		await expect(adminDb.expense.count({ where: { id } })).resolves.toBe(0);
		expect(Number(await balanceOf(savings))).toBe(Number(after) - 100);

		await expectBody(
			await post("/income/undo", { token: undone.redo }),
			c.undo,
		);
		await expect(adminDb.expense.count({ where: { id } })).resolves.toBe(1);
		expect(await balanceOf(savings)).toBe(after);
	});

	it("repeats: creates the recurring income and deletes it with the entry", async () => {
		const made = await expectBody<Write>(
			await post(
				"/income",
				input({
					title: "Monthly pay",
					repeats: { frequency: "MONTHLY" },
				}),
			),
			c.create,
			201,
		);
		const templateId = made.income.templateId;
		expect(templateId).toBeTruthy();
		const template = await adminDb.recurringTemplate.findUniqueOrThrow({
			where: { id: templateId as string },
		});
		expect(template.direction).toBe("IN");

		const preview = await expectBody<Preview>(
			await post(`/income/${made.income.id}/preview`, {}),
			c.previewDelete,
		);
		expect(preview.changes.find((x) => x.id === "netWorth")).toBeTruthy();

		const res = await call(`/income/${made.income.id}`, {
			method: "DELETE",
			headers: as,
			body: { templateId },
			idempotent: true,
		});
		await expectBody(res, c.delete);
		await expect(
			adminDb.recurringTemplate.count({ where: { id: templateId as string } }),
		).resolves.toBe(0);
	});

	it("deletes an income, and its undo recreates it at the same id", async () => {
		const made = await expectBody<Write>(
			await post("/income", input({ title: "Delete me", amount: "50" })),
			c.create,
			201,
		);
		const deleted = await expectBody<{ id: string; undo: string }>(
			await call(`/income/${made.income.id}`, {
				method: "DELETE",
				headers: as,
				idempotent: true,
			}),
			c.delete,
		);
		await expect(
			adminDb.expense.count({ where: { id: deleted.id } }),
		).resolves.toBe(0);
		await expectBody(
			await post("/income/undo", { token: deleted.undo }),
			c.undo,
		);
		const back = await adminDb.expense.findUniqueOrThrow({
			where: { id: deleted.id },
		});
		expect(back.title).toBe("Delete me");
		expect(back.amount.toString()).toBe("50");
	});

	it("refuses another user's account and entry", async () => {
		const made = await expectBody<Write>(
			await post("/income", input({ title: "Alice only" })),
			c.create,
			201,
		);
		await expectProblem(
			await post("/income", input({ title: "Steal" }), asOther),
			404,
			"not_found",
		);
		await expectProblem(
			await call(`/income/${made.income.id}`, {
				method: "DELETE",
				headers: asOther,
				idempotent: true,
			}),
			404,
			"not_found",
		);
		await expectProblem(
			await post(`/income/${made.income.id}/preview`, {}, asOther),
			404,
			"not_found",
		);
		await expectProblem(
			await post("/income/undo", { token: made.undo }, asOther),
			400,
			"bad_request",
		);
	});

	it("refuses money as a JSON number, and needs write:money", async () => {
		await expectProblem(
			await post("/income", input({ amount: 500 })),
			400,
			"validation_failed",
		);
		const expensesOnly = await asKey(userId, ["read", "write:expenses"]);
		await expectProblem(
			await post("/income", input(), expensesOnly),
			403,
			"missing_scope",
		);
	});
});
