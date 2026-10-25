/**
 * /api/v1/budget set-up and Limits on Postgres: the first write of the
 * budget (previewed, refused a second time), a limit changed for this month
 * and from now on, each with the undo that fits it. USD book, Limits style:
 * Dining 200.00 and Groceries 420.00, funded at set-up.
 */
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SetupInput } from "~/lib/schemas/envelope";
import { seedUser } from "~/server/services/envelope/__tests__/pg-fixture";
import { adminDb } from "~/test/pg-harness";
import {
	call,
	expectBody,
	expectProblem,
} from "../../core/__tests__/harness";
import { mobileFrom, toV1, uuid, withoutStamps } from "./fixtures";

const asMobile = mobileFrom("198.51.100.83");

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.budget;
type Preview = { detail?: { kind: string; result: unknown } };
type Write = { result: Record<string, unknown>; undo: string | null };
type Month = {
	month: { key: number };
	groups: {
		envelopes: { id: string; name: string; left: { minor: number } }[];
	}[];
};

function limitsInput(s: { rent: string; dining: string }): SetupInput {
	const target = (amountMinor: number) => ({
		kind: "MONTHLY" as const,
		amountMinor,
		mode: "SET_ASIDE" as const,
		cadence: "MONTH" as const,
	});
	const env = (
		key: string,
		name: string,
		categoryIds: string[],
		amountMinor?: number,
		isDefault = false,
	) => ({
		key,
		name,
		groupKey: "limits",
		kind: "MONTHLY" as const,
		isDefault,
		categoryIds,
		...(amountMinor ? { target: target(amountMinor) } : {}),
	});
	return {
		style: "LIMITS",
		groups: [{ key: "limits", name: "Limits", role: "SPENDING" }],
		envelopes: [
			env("dining", "Dining", [s.dining], 20_000),
			env("groceries", "Groceries", [s.rent], 42_000),
			env("else", "Everything else", [], undefined, true),
		],
	};
}

describe("/api/v1/budget set-up and Limits", () => {
	let as: Record<string, string>;
	let stranger: Record<string, string>;
	let ids: Record<string, string>;

	const post = (path: string, body: unknown, headers = as) =>
		call(path, { method: "POST", headers, body: toV1(body), idempotent: true });
	const left = async (name: string) =>
		(
			await expectBody<Month>(
				await call("/budget/month", { headers: as }),
				c.month,
			)
		).groups
			.flatMap((g) => g.envelopes)
			.find((e) => e.name === name)?.left.minor;
	const undo = (token: string | null) => post("/budget/undo", { token });

	beforeAll(async () => {
		const s = await seedUser();
		as = await asMobile(s.user.id);
		stranger = await asMobile((await seedUser()).user.id);

		// Before a budget exists the month reads null, and a style can be previewed.
		expect(
			await expectBody(await call("/budget/month", { headers: as }), c.month),
		).toBeNull();
		await expectBody(
			await call("/budget/setup-preset?style=LIMITS", { headers: as }),
			c.setupPreset,
		);

		const body = limitsInput(s);
		const preview = await expectBody<Preview>(
			await post("/budget/setup/preview", body),
			c.previewSetup,
		);
		await expect(
			adminDb.budgetBook.count({ where: { createdById: s.user.id } }),
		).resolves.toBe(0);
		const written = await expectBody<Write>(
			await post("/budget/setup", body),
			c.setup,
			201,
		);
		expect(withoutStamps(written.result)).toEqual(
			withoutStamps(preview.detail?.result),
		);
		// A first set-up cannot be taken back.
		expect(written.undo).toBeNull();
		await expectProblem(await post("/budget/setup", body), 409, "conflict");
		const envelopes = await adminDb.envelope.findMany({
			where: { book: { createdById: s.user.id } },
		});
		ids = Object.fromEntries(envelopes.map((e) => [e.name, e.id]));
	});

	it("funds the limits at set-up", async () => {
		expect(await left("Dining")).toBe(20_000);
		expect(await left("Groceries")).toBe(42_000);
	});

	it("raises a limit for this month only, and its token takes the money back", async () => {
		const body = {
			id: uuid(),
			envelopeId: ids.Dining,
			amountMinor: 25_000,
			scope: "THIS_MONTH",
		};
		const preview = await expectBody<Preview>(
			await post("/budget/limits/preview", body),
			c.previewSetLimit,
		);
		expect(await left("Dining")).toBe(20_000);
		const written = await expectBody<Write>(
			await post("/budget/limits", body),
			c.setLimit,
		);
		expect(withoutStamps(written.result)).toEqual(
			withoutStamps(preview.detail?.result),
		);
		expect(await left("Dining")).toBe(25_000);
		const undone = await expectBody<{ result: { kind: string } }>(
			await undo(written.undo),
			c.undo,
		);
		expect(undone.result.kind).toBe("movement.undo");
		expect(await left("Dining")).toBe(20_000);
	});

	it("changes a limit from now on, reverts it once, and refuses a stale revert", async () => {
		const first = await expectBody<Write>(
			await post("/budget/limits", {
				id: uuid(),
				envelopeId: ids.Groceries,
				amountMinor: 40_000,
				scope: "FROM_NOW_ON",
			}),
			c.setLimit,
		);
		expect(await left("Groceries")).toBe(40_000);
		const second = await expectBody<Write>(
			await post("/budget/limits", {
				id: uuid(),
				envelopeId: ids.Groceries,
				amountMinor: 38_000,
				scope: "FROM_NOW_ON",
			}),
			c.setLimit,
		);
		// The first token belongs to a limit that has been replaced since.
		await expectProblem(await undo(first.undo), 409, "conflict");
		const undone = await expectBody<{ result: { kind: string } }>(
			await undo(second.undo),
			c.undo,
		);
		expect(undone.result.kind).toBe("limit.revert");
		await expectProblem(await undo(second.undo), 409, "conflict");
	});

	it("keeps a limit private to its owner", async () => {
		await expectProblem(
			await post(
				"/budget/limits",
				{
					id: uuid(),
					envelopeId: ids.Dining,
					amountMinor: 1_000,
					scope: "THIS_MONTH",
				},
				stranger,
			),
			404,
			"not_found",
		);
	});

	it("refuses a limit that is not whole minor units (400)", async () => {
		await expectProblem(
			await post("/budget/limits", {
				id: uuid(),
				envelopeId: ids.Dining,
				amountMinor: 1_000.5,
				scope: "THIS_MONTH",
			}),
			400,
			"bad_request",
		);
	});
});
