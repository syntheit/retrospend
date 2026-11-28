/**
 * The engine's category vectors (packages/engine/src/category-vectors.ts,
 * expected values derived by hand there) against the server, on a real
 * Postgres. Each step runs through the real v1 route (POST and PATCH
 * /categories, POST /expenses for the expense a category's count default is
 * held against), then the rows are read back as a device store
 * (src/test/engine-store.ts) and held to the hand-derived values; the same
 * step runs through the engine on the store as it was before the route, and
 * the two stores must be equal row by row on every column the engine keeps
 * (the version included, the engine's being a placeholder that follows the
 * same count). The `spent` figure must read the same on both sides. A refusal
 * must carry the engine's words and write nothing.
 *
 * The process zone is not the saved zone, so a server that read its own zone
 * would date the expense another day. Rates are global and a case needs
 * exactly its seed, so each reset replaces the table; the rows other files
 * left in this worker's database are put back after.
 */

import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { createCategoryWrite } from "~/server/services/category/create.mutation";
import { editCategory } from "~/server/services/category/edit.mutation";
import { engineStoreOf } from "~/test/engine-store";
import { deviceReadFrom, expectSame, serverRead } from "~/test/parity/compare";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import type { Prisma } from "~prisma";
// The root app does not depend on the engine package; its cases are plain data and code.
import {
	checkCategoryState,
	differingCategoryRows,
} from "../../../../packages/engine/src/category-conformance";
import {
	CATEGORY_CREATE_MUTATION,
	CATEGORY_UPDATE_MUTATION,
} from "../../../../packages/engine/src/category-mutations";
import type {
	CategoryStep,
	CategoryVector,
} from "../../../../packages/engine/src/category-vector-types";
import { categoryVectors } from "../../../../packages/engine/src/category-vectors";
import { planOf } from "../../../../packages/engine/src/device/book";
import { LocalDb } from "../../../../packages/engine/src/local-db";
import { type V1, v1For } from "./recurring-write-kit";

declare const process: { env: Record<string, string | undefined> };
const originalTZ = process.env.TZ;
let others: Prisma.ExchangeRateCreateManyInput[] = [];

beforeAll(async () => {
	others = await adminDb.exchangeRate.findMany();
});

afterEach(() => {
	vi.useRealTimers();
	if (originalTZ === undefined) delete process.env.TZ;
	else process.env.TZ = originalTZ;
});

afterAll(async () => {
	await adminDb.exchangeRate.deleteMany({});
	await adminDb.exchangeRate.createMany({ data: others });
});

interface Sent {
	method: string;
	path: string;
	body: object;
}

/** The v1 request an op is. The bodies are the engine's: the same fields the route takes. */
function requestOf(op: CategoryStep["op"]): Sent {
	switch (op.kind) {
		case "categoryCreate":
			return { method: "POST", path: "/categories", body: op.body };
		case "categoryUpdate":
			return {
				method: "PATCH",
				path: `/categories/${op.body.id}`,
				body: op.body,
			};
		case "create":
			return { method: "POST", path: "/expenses", body: op.body };
	}
}

/**
 * The words a refusal carries: the problem's detail (the service's message),
 * or, for a body the schema refuses, the first issue the answer lists. A
 * problem whose message is its title (id_taken) carries it as the title only.
 */
async function detailOf(res: Response) {
	const text = await res.text();
	const body = JSON.parse(text) as {
		detail?: string;
		code?: string;
		title?: string;
		errors?: { message: string }[];
	};
	return {
		status: res.status,
		code: body.code,
		detail: body.detail ?? body.errors?.[0]?.message ?? body.title,
		text,
	};
}

async function seedServer(vector: CategoryVector) {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: {
			homeCurrency: vector.seed.homeCurrency,
			timeZone: vector.seed.timeZone,
			defaultRateTypes: vector.seed.defaultRateTypes ?? {},
		},
	});
	await adminDb.exchangeRate.deleteMany({});
	await adminDb.exchangeRate.createMany({
		data: vector.seed.rates.map((r) => ({
			currency: r.currency,
			type: r.type,
			rate: r.rate,
			date: r.date,
		})),
	});
	for (const c of vector.categories ?? [])
		await fixtureDb.category.create({
			data: {
				id: c.id,
				userId: user.id,
				name: c.name,
				color: c.color as Prisma.CategoryCreateInput["color"],
				kind: c.kind,
				icon: c.icon ?? null,
				excludeByDefault: c.excludeByDefault ?? false,
				version: c.version ?? 0,
			},
		});
	return user.id;
}

/** Ids are global and the vectors share them, so a case's rows go when it is done. */
async function clear(userId: string) {
	await adminDb.expense.deleteMany({ where: { userId } });
	await adminDb.category.deleteMany({ where: { userId } });
}

async function runVector(vector: CategoryVector) {
	process.env.TZ = "Pacific/Auckland";
	const userId = await seedServer(vector);
	try {
		await runSteps(vector, userId);
	} finally {
		await clear(userId);
	}
}

async function runSteps(vector: CategoryVector, userId: string) {
	const v1: V1 = await v1For(userId);
	for (const step of vector.steps) {
		const now = new Date(step.now);
		const device = await engineStoreOf(userId);
		const { id, write } = planOf(step.op, device.snapshot(), {}, now);
		const sent = requestOf(step.op);
		vi.useFakeTimers({ toFake: ["Date"], now });
		try {
			const res = await v1(sent.method, sent.path, sent.body);
			const want = step.expect;
			const after = await engineStoreOf(userId);
			if ("done" in want) {
				expect(res.status, await res.clone().text()).toBeLessThan(300);
				await checkCategoryState(after, want.done, now);
				await new LocalDb(device).write(id, write);
				expect(differingCategoryRows(device, after)).toEqual([]);
				if (want.done.spent !== undefined)
					expectSame(
						await deviceReadFrom(device, userId, ["spent"], {}, () => now),
						await serverRead(userId, ["spent"]),
						["spent"],
					);
				continue;
			}
			const failed = await detailOf(res);
			expect(failed.status, failed.text).toBeGreaterThanOrEqual(400);
			const error = await new LocalDb(device)
				.write(id, write)
				.catch((e: unknown) => e);
			expect(failed.detail).toBe(want.refused);
			expect((error as Error).message).toBe(want.refused);
			// A refusal writes nothing: `device` was read before the route ran, so
			// the server's rows after it equal them, and the engine's refusal left
			// the device's rows as they were.
			expect(differingCategoryRows(device, after)).toEqual([]);
		} finally {
			vi.useRealTimers();
		}
	}
}

describe("category conformance (server and device, real Postgres)", () => {
	for (const vector of categoryVectors)
		it(vector.name, () => runVector(vector), 60_000);
});

describe("the device mutations touch what the server's do", () => {
	it.each([
		[CATEGORY_CREATE_MUTATION, createCategoryWrite],
		[CATEGORY_UPDATE_MUTATION, editCategory],
	])("%s", (device, server) => {
		expect(device.id).toBe(server.id);
		expect([...device.touches]).toEqual([...server.touches]);
	});
});
