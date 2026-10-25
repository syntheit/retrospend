/**
 * GET /needs-you and GET /figures/glance on Postgres: Home's two reads over
 * v1, parsed with the contract's schemas, scoped to the caller.
 */
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	seedUser,
	setupInput,
} from "~/server/services/envelope/__tests__/pg-fixture";
import { setupEnvelopeBook } from "~/server/services/envelope/setup.mutation";
import { forUser } from "~/server/services/preview";
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

type Money = { minor: number; currency: string };
type NeedsYou = {
	items: {
		type: string;
		group: string;
		title: string | null;
		amount: Money | null;
	}[];
	counts: Record<string, number>;
};
type Glance = {
	home: string;
	spent: { id: string; value: Money | null };
	netWorth: { id: string; value: Money | null };
	owedToYou: { value: Money | null };
	budget: unknown;
	pace: { this: number[] | null };
};

describe("Home reads over v1", () => {
	let userId: string;
	let otherId: string;
	let as: Record<string, string>;
	let asOther: Record<string, string>;

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
		otherId = (await createTestUser()).user.id;
		as = await asMobile(userId);
		asOther = await asMobile(otherId);
	});

	it("lists what waits for the caller, in one ordered list with counts", async () => {
		const empty = await expectBody<NeedsYou>(
			await call("/needs-you", { headers: asOther }),
			contract["needs-you"].list,
		);
		expect(empty.items.some((i) => i.type === "recurring.overdue")).toBe(false);

		await adminDb.recurringTemplate.create({
			data: {
				userId,
				name: "Overdue rent",
				amount: "900",
				currency: "USD",
				frequency: "MONTHLY",
				nextDueDate: new Date(Date.now() - 3 * 86_400_000),
				autoPay: false,
			},
		});
		const list = await expectBody<NeedsYou>(
			await call("/needs-you", { headers: as }),
			contract["needs-you"].list,
		);
		const item = list.items.find((i) => i.type === "recurring.overdue");
		expect(item).toMatchObject({
			group: "activity",
			title: "Overdue rent",
			amount: { minor: 90_000, currency: "USD" },
		});
		expect(list.counts.activity).toBeGreaterThanOrEqual(1);
		expect(list.counts.total).toBe(list.items.length);

		// Another user's item never shows up here.
		const again = await expectBody<NeedsYou>(
			await call("/needs-you", { headers: asOther }),
			contract["needs-you"].list,
		);
		expect(again.items.some((i) => i.title === "Overdue rent")).toBe(false);
	});

	it("reads the glance with tagged figures and no budget part without a book", async () => {
		const user = (await createTestUser()).user.id;
		const mine = await asMobile(user);
		const cat = await adminDb.category.create({
			data: { userId: user, name: "Food", color: "teal" },
		});
		const made = await call("/expenses", {
			method: "POST",
			headers: mine,
			idempotent: true,
			body: {
				title: "Groceries",
				amount: "42.10",
				currency: "USD",
				date: new Date().toISOString().slice(0, 10),
				categoryId: cat.id,
			},
		});
		expect(made.status).toBe(201);

		const glance = await expectBody<Glance>(
			await call("/figures/glance", { headers: mine }),
			contract.figures.glance,
		);
		expect(glance.home).toBe("USD");
		expect(glance.spent.id).toBe("glance.spent");
		expect(glance.spent.value).toEqual({ minor: 4210, currency: "USD" });
		expect(glance.netWorth.id).toBe("netWorth");
		expect(glance.budget).toBeNull();
	});

	it("carries the budget verdict when the caller has a book", async () => {
		const seeded = await seedUser();
		await forUser(seeded.user.id).apply(setupEnvelopeBook, {
			...setupInput(seeded),
			timeZone: "UTC",
		});
		const mine = await asMobile(seeded.user.id);
		const glance = await expectBody<{
			budget: {
				state: string;
				verdict: { style: string };
				notPlannedYet: { id: string };
			};
		}>(
			await call("/figures/glance", { headers: mine }),
			contract.figures.glance,
		);
		expect(glance.budget).toMatchObject({
			state: "ready",
			verdict: { style: "FLEX" },
			notPlannedYet: { id: "budget.notPlannedYet" },
		});
	});

	it("needs the read scope", async () => {
		const key = await asKey(userId, ["write:money"]);
		await expectProblem(
			await call("/needs-you", { headers: key }),
			403,
			"missing_scope",
		);
		await expectProblem(
			await call("/figures/glance", { headers: key }),
			403,
			"missing_scope",
		);
		await expectProblem(await call("/needs-you"), 401, "unauthenticated");
	});
});
