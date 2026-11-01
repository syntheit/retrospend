/**
 * /api/v1/accounts/order on Postgres: the sort mode and the custom order are
 * two facts. Switching the mode leaves the order exactly as it was, an order
 * survives in the stored row, a foreign or repeated id is refused, one
 * person's order is not another's, and the WEALTH page settings the order
 * shares a row with keep their toggles.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	call,
	expectBody,
	expectProblem,
	asMobile as sessionHeaders,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.accounts;
type Order = { sort: string; order: string[] };

describe("/api/v1/accounts/order", () => {
	let as: Record<string, string>;
	let stranger: Record<string, string>;
	let userId: string;
	const ids: string[] = [];
	let foreign = "";

	const put = (body: unknown, headers = as) =>
		call("/accounts/order", {
			method: "PUT",
			headers,
			body,
			idempotent: true,
		});
	const get = async (headers = as) =>
		expectBody<Order>(await call("/accounts/order", { headers }), c.order);
	const open = async (headers: Record<string, string>, name: string) => {
		const id = randomUUID();
		const res = await call("/accounts", {
			method: "POST",
			headers,
			body: { id, name, type: "CASH", currency: "USD", balance: "10" },
			idempotent: true,
		});
		expect(res.status).toBe(201);
		return id;
	};

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
		as = {
			...(await sessionHeaders(userId)),
			"x-forwarded-for": "198.51.100.91",
		};
		const other = (await createTestUser()).user.id;
		stranger = {
			...(await sessionHeaders(other)),
			"x-forwarded-for": "198.51.100.92",
		};
		for (const name of ["Alpha", "Bravo", "Charlie"])
			ids.push(await open(as, name));
		foreign = await open(stranger, "Not yours");
	});

	it("starts on value with no custom order", async () => {
		expect(await get()).toEqual({ sort: "value", order: [] });
	});

	it("saves the order and the sort, and reads them back exactly", async () => {
		const [a, b, c3] = ids as [string, string, string];
		const order = [c3, a, b];
		const saved = await expectBody<Order>(
			await put({ sort: "custom", order }),
			c.setOrder,
		);
		expect(saved).toEqual({ sort: "custom", order });
		expect(await get()).toEqual({ sort: "custom", order });
	});

	it("keeps the custom order when only the sort changes, and back again", async () => {
		const before = await get();
		const away = await expectBody<Order>(
			await put({ sort: "name" }),
			c.setOrder,
		);
		expect(away.sort).toBe("name");
		expect(away.order).toEqual(before.order);
		const back = await expectBody<Order>(
			await put({ sort: "custom" }),
			c.setOrder,
		);
		expect(back).toEqual({ sort: "custom", order: before.order });
	});

	it("keeps the sort when only the order changes", async () => {
		await put({ sort: "updated" });
		const order = [...ids].reverse();
		const saved = await expectBody<Order>(await put({ order }), c.setOrder);
		expect(saved).toEqual({ sort: "updated", order });
	});

	it("refuses an empty body, a repeated id and an account that is not yours", async () => {
		const before = await get();
		await expectProblem(await put({}), 400, "validation_failed");
		const [a] = ids as [string];
		await expectProblem(await put({ order: [a, a] }), 400, "bad_request");
		await expectProblem(
			await put({ order: [a, foreign] }),
			400,
			"bad_request",
		);
		await expectProblem(
			await put({ sort: "newest" }),
			400,
			"validation_failed",
		);
		expect(await get()).toEqual(before);
	});

	it("keeps each person's order to themselves", async () => {
		expect(await get(stranger)).toEqual({ sort: "value", order: [] });
		await put({ sort: "name", order: [foreign] }, stranger);
		expect((await get()).order).toEqual([...ids].reverse());
		expect(await get(stranger)).toEqual({ sort: "name", order: [foreign] });
	});

	it("shares the WEALTH settings row without clobbering its toggles", async () => {
		const row = await adminDb.userPageSetting.findUniqueOrThrow({
			where: { userId_page: { userId, page: "WEALTH" } },
		});
		await adminDb.userPageSetting.update({
			where: { id: row.id },
			data: {
				settings: {
					...(row.settings as object),
					showHistoryChart: false,
				},
			},
		});
		const saved = await expectBody<Order>(
			await put({ sort: "type" }),
			c.setOrder,
		);
		expect(saved.order).toEqual([...ids].reverse());
		const after = await adminDb.userPageSetting.findUniqueOrThrow({
			where: { id: row.id },
		});
		expect(after.settings).toMatchObject({
			showHistoryChart: false,
			sort: "type",
		});
	});
});
