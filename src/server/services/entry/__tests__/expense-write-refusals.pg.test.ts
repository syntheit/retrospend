/**
 * Characterization of today's expense write refusals (slice-device-writes
 * PR0), pinned on main before the write rules move into a shared core. Each
 * case runs through web tRPC `entry.expense.*`, the legacy `expense.*` router
 * and v1 /expenses, preview twins included where a transport has them, and
 * pins the status or code, the message and that the stored row is unchanged.
 * A case a transport cannot take is left out of its map: legacy updates take
 * only uuid ids, so a cuid row (a transfer's fee) has no legacy update.
 *
 * Where one transport answers differently from another, that is the point:
 * the refactor must keep each answer as it is. ARS home, USD 100 at Blue
 * 1,468 books ARS 146,800.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fixtureDb } from "~/server/api/v1/core/__tests__/harness";
import { seedArsRates } from "~/server/services/accounts/test-fixtures";
import {
	book,
	CATEGORY_NOT_FOUND,
	EXPENSE_NOT_FOUND,
	expectUnchanged,
	FEE_DELETE,
	type Fields,
	feeRow,
	incomeRow,
	issues,
	LEG_MONEY,
	lunch,
	MISSING_RATE,
	makeWorld,
	NAMES,
	type Name,
	type Out,
	rowIn,
	sharedRow,
	spreadRow,
	stored,
	trpc,
	v1Problem,
	type World,
} from "./expense-write-kit";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

beforeAll(seedArsRates);

let w: World;
beforeAll(async () => {
	w = await makeWorld();
});

type Expected = Partial<Record<Name, Out>>;
type Setup = (w: World) => Promise<{ id: string; fields?: Fields }>;
type Case = readonly [name: string, setup: Setup, expected: Expected];

const NOT_FOUND = trpc("NOT_FOUND", EXPENSE_NOT_FOUND);
const V1_NOT_FOUND = v1Problem(404, "not_found", EXPENSE_NOT_FOUND);
const notFound: Expected = {
	entry: NOT_FOUND,
	legacy: NOT_FOUND,
	v1: V1_NOT_FOUND,
};
/** tRPC answers a bad category FORBIDDEN; v1 answers it 404 not_found. */
const FORBIDDEN = trpc("FORBIDDEN", CATEGORY_NOT_FOUND);
const V1_CATEGORY = v1Problem(404, "not_found", CATEGORY_NOT_FOUND);
const badCategory: Expected = {
	entry: FORBIDDEN,
	legacy: FORBIDDEN,
	v1: V1_CATEGORY,
};
const missingRate: Expected = MISSING_RATE;
const webOnly = (out: Out, v1: Out): Expected => ({ entry: out, v1 });

/** A booked own expense, edited with `pick` of the world's fields on top. */
const edit =
	(pick: (w: World) => Partial<Fields>): Setup =>
	async (w) => ({
		id: await book(w.userId, lunch(w)),
		fields: lunch(w, { title: "Changed", ...pick(w) }),
	});
const fee =
	(pick: (w: World) => Partial<Fields>): Setup =>
	async (w) => ({
		id: await feeRow(w.userId),
		fields: lunch(w, { title: "Fee", ...pick(w) }),
	});
const unknown: Setup = async (w) => ({ id: randomUUID(), fields: lunch(w) });
const strangers: Setup = async (w) => ({
	id: await book(w.otherId, lunch(w, { categoryId: w.other })),
	fields: lunch(w),
});
const gone: Setup = async (w) => {
	const id = await book(w.userId, lunch(w));
	await fixtureDb.expense.delete({ where: { id } });
	return { id, fields: lunch(w) };
};
const income: Setup = async (w) => ({
	id: await incomeRow(w.userId),
	fields: lunch(w),
});
const part: Setup = async (w) => ({
	id: (await spreadRow(w)).parts[0] ?? "",
	fields: lunch(w),
});
const shared: Setup = async (w) => ({
	id: await sharedRow(w.userId, randomUUID()),
	fields: lunch(w),
});
const ARS_1600 = { amount: "1600", currency: "ARS" };

/** One row per transport that has an answer for the case, so one failing does not hide the others. */
const perTransport = (cases: readonly Case[]) =>
	cases.flatMap(([what, setup, expected]) =>
		NAMES.filter((name) => expected[name]).map(
			(name) => [name, what, setup, expected[name] as Out] as const,
		),
	);

async function refused(
	name: Name,
	setup: Setup,
	want: Out,
	op: "update" | "delete",
) {
	const t = w[name];
	const run = async (preview: boolean) => {
		const { id, fields } = await setup(w);
		const f = fields as Fields;
		const go =
			op === "update"
				? preview
					? t.previewUpdate?.(id, f)
					: t.update(id, f)
				: preview
					? t.previewDelete?.(id)
					: t.delete(id);
		return expectUnchanged(id, () => go as Promise<Out>);
	};
	expect(await run(false)).toEqual(want);
	if (op === "update" ? t.previewUpdate : t.previewDelete)
		expect(await run(true), "preview").toEqual(want);
}

describe("update refusals leave the row as it was", () => {
	const cases: readonly Case[] = [
		["an id that does not exist", unknown, notFound],
		["another user's expense", strangers, notFound],
		["an expense that is gone", gone, notFound],
		["an income row", income, webOnly(NOT_FOUND, V1_NOT_FOUND)],
		["a spread part", part, webOnly(NOT_FOUND, V1_NOT_FOUND)],
		["a shared expense's id", shared, notFound],
		[
			"a category of another user",
			edit((w) => ({ categoryId: w.other })),
			badCategory,
		],
		[
			"a category that does not exist",
			edit((w) => ({ categoryId: w.missing })),
			badCategory,
		],
		[
			"an income category",
			edit((w) => ({ categoryId: w.income })),
			badCategory,
		],
		[
			"a transfer fee with its amount changed",
			fee(() => ARS_1600),
			webOnly(
				trpc("BAD_REQUEST", LEG_MONEY),
				v1Problem(400, "bad_request", LEG_MONEY),
			),
		],
		["a currency with no rate", edit(() => ({ currency: "BTN" })), missingRate],
	];
	it.each(perTransport(cases))("%s: %s", (name, _what, setup, want) =>
		refused(name, setup, want, "update"),
	);
});

describe("combined refusals: which one wins", () => {
	// The category is read first on v1 and last on tRPC, so a bad id with a bad
	// category is "Category not found" on v1 and "Expense not found" on tRPC.
	const cases: readonly Case[] = [
		[
			"an unknown id and an unknown category",
			async (w) => ({
				id: randomUUID(),
				fields: lunch(w, { categoryId: w.missing }),
			}),
			{ entry: NOT_FOUND, legacy: NOT_FOUND, v1: V1_CATEGORY },
		],
		[
			"another user's expense and another user's category",
			async (w) => ({
				id: await book(w.otherId, lunch(w, { categoryId: w.other })),
				fields: lunch(w, { categoryId: w.other }),
			}),
			{ entry: NOT_FOUND, legacy: NOT_FOUND, v1: V1_CATEGORY },
		],
		[
			"a gone expense and an income category",
			async (w) => ({
				id: (await gone(w)).id,
				fields: lunch(w, { categoryId: w.income }),
			}),
			{ entry: NOT_FOUND, legacy: NOT_FOUND, v1: V1_CATEGORY },
		],
		[
			"a transfer fee with its amount changed and an unknown category",
			fee((w) => ({ ...ARS_1600, categoryId: w.missing })),
			webOnly(trpc("BAD_REQUEST", LEG_MONEY), V1_CATEGORY),
		],
		[
			"a transfer fee with its money kept and an unknown category",
			fee((w) => ({ amount: "1500", currency: "ARS", categoryId: w.missing })),
			webOnly(FORBIDDEN, V1_CATEGORY),
		],
		[
			"an income row and an unknown category",
			async (w) => ({
				id: await incomeRow(w.userId),
				fields: lunch(w, { categoryId: w.missing }),
			}),
			webOnly(NOT_FOUND, V1_CATEGORY),
		],
		[
			"a currency with no rate and an unknown category",
			edit((w) => ({ currency: "BTN", categoryId: w.missing })),
			badCategory,
		],
	];
	it.each(perTransport(cases))("%s: update: %s", (name, _what, setup, want) =>
		refused(name, setup, want, "update"),
	);

	it.each(perTransport([["a bad id", unknown, notFound]]))(
		"%s: a delete names no category, so %s is the only refusal",
		(name, _what, setup, want) => refused(name, setup, want, "delete"),
	);
});

describe("delete refusals leave the row as it was", () => {
	const cases: readonly Case[] = [
		["an id that does not exist", unknown, notFound],
		["another user's expense", strangers, notFound],
		["an expense that is gone", gone, notFound],
		["an income row", income, webOnly(NOT_FOUND, V1_NOT_FOUND)],
		["a spread part", part, webOnly(NOT_FOUND, V1_NOT_FOUND)],
		["a shared expense's id", shared, notFound],
		[
			"a transfer fee",
			fee(() => ({})),
			webOnly(
				trpc("BAD_REQUEST", FEE_DELETE),
				v1Problem(400, "bad_request", FEE_DELETE),
			),
		],
	];
	it.each(perTransport(cases))("%s: %s", (name, _what, setup, want) =>
		refused(name, setup, want, "delete"),
	);
});

describe("create refusals write nothing", () => {
	const ABOVE_ZERO = {
		code: "custom",
		path: ["amount"],
		message: "Enter an amount above zero",
	};
	const LEGACY_POSITIVE = {
		origin: "number",
		code: "too_small",
		minimum: 0,
		inclusive: false,
		path: ["amount"],
		message: "Amount must be positive",
	};
	const zero: Expected = {
		entry: issues([ABOVE_ZERO]),
		legacy: issues([LEGACY_POSITIVE]),
		v1: {
			...v1Problem(400, "validation_failed", "Validation failed"),
			errors: ["Must be above zero"],
		},
	};
	const negative: Expected = {
		entry: issues([
			{
				origin: "string",
				code: "invalid_format",
				format: "regex",
				pattern: "/^\\d{1,13}(\\.\\d{1,12})?$/",
				path: ["amount"],
				message: "Enter an amount like 1234.56",
			},
			ABOVE_ZERO,
		]),
		legacy: issues([LEGACY_POSITIVE]),
		v1: {
			...v1Problem(400, "validation_failed", "Validation failed"),
			errors: ["Use digits and at most 8 decimals, like 1234.56"],
		},
	};
	const cases: readonly (readonly [string, (w: World) => Fields, Expected])[] =
		[
			[
				"a category of another user",
				(w) => lunch(w, { categoryId: w.other }),
				badCategory,
			],
			[
				"a category that does not exist",
				(w) => lunch(w, { categoryId: w.missing }),
				badCategory,
			],
			[
				"an income category",
				(w) => lunch(w, { categoryId: w.income }),
				badCategory,
			],
			[
				"a currency with no rate",
				(w) => lunch(w, { currency: "BTN" }),
				missingRate,
			],
			[
				"a currency with no rate and an unknown category",
				(w) => lunch(w, { currency: "BTN", categoryId: w.missing }),
				badCategory,
			],
			["an amount of zero", (w) => lunch(w, { amount: "0" }), zero],
			["a negative amount", (w) => lunch(w, { amount: "-5" }), negative],
		];
	const rows = cases.flatMap(([what, fields, expected]) =>
		NAMES.filter((name) => expected[name]).map(
			(name) => [name, what, fields, expected[name] as Out] as const,
		),
	);
	it.each(rows)("%s: %s", async (name, _what, fields, want) => {
		const t = w[name];
		const count = () =>
			fixtureDb.expense.count({ where: { userId: w.userId } });
		const before = await count();
		expect(await t.create(randomUUID(), fields(w))).toEqual(want);
		if (t.previewCreate)
			expect(await t.previewCreate(randomUUID(), fields(w)), "preview").toEqual(
				want,
			);
		expect(await count()).toBe(before);
	});

	// tRPC answers the unique id violation as CONFLICT in the same words v1 uses for 409
	// id_taken, and keeps the database's own text (file path, key name) out of the message.
	const taken: Expected = {
		entry: trpc("CONFLICT", "That id is already used"),
		legacy: trpc("CONFLICT", "That id is already used"),
		v1: v1Problem(409, "id_taken", "That id is already used"),
	};
	it.each(NAMES)(
		"%s: an id that is taken leaves the first expense as it was",
		async (name) => {
			const t = w[name];
			const id = await book(w.userId, lunch(w));
			const first = await stored(id);
			expect(await t.create(id, lunch(w, { title: "Again" }))).toEqual(
				taken[name],
			);
			if (t.previewCreate)
				expect(
					await t.previewCreate(id, lunch(w, { title: "Again" })),
					"preview",
				).toEqual(taken[name]);
			expect(await stored(id)).toEqual(first);
		},
	);
});

describe("an unchanged category passes", () => {
	it.each(NAMES)(
		"%s: an edit that keeps the category an old row sits in is taken",
		async (name) => {
			const id = await rowIn(w.userId, w.income);
			const keep = lunch(w, { title: `Kept ${name}`, categoryId: w.income });
			expect(await w[name].update(id, keep)).toEqual({ ok: true });
			expect(await stored(id)).toMatchObject({
				title: `Kept ${name}`,
				categoryId: w.income,
			});
		},
	);

	it.each(NAMES)(
		"%s: a change from the old category to another valid one is taken",
		async (name) => {
			const id = await rowIn(w.userId, w.income);
			const move = lunch(w, { title: "Moved", categoryId: w.holdByDefault });
			expect(await w[name].update(id, move)).toEqual({ ok: true });
			expect(await stored(id)).toMatchObject({
				title: "Moved",
				categoryId: w.holdByDefault,
			});
		},
	);

	it.each(NAMES)(
		"%s: a change to an income category is refused",
		async (name) => {
			const id = await rowIn(w.userId, w.food);
			const back = lunch(w, { title: "Back", categoryId: w.income });
			expect(await expectUnchanged(id, () => w[name].update(id, back))).toEqual(
				name === "v1" ? V1_CATEGORY : FORBIDDEN,
			);
		},
	);
});

describe("what the legacy router still lets through", () => {
	it("updates and deletes an income row, an expense's part and a transfer's fee", async () => {
		const legacy = w.legacy;
		const salary = await incomeRow(w.userId);
		expect(await legacy.update(salary, lunch(w, { title: "Edited" }))).toEqual({
			ok: true,
		});
		expect(await stored(salary)).toMatchObject({
			title: "Edited",
			direction: "IN",
		});
		expect(await legacy.delete(salary)).toEqual({ ok: true });
		expect(await stored(salary)).toBeNull();

		const { id: parent, parts } = await spreadRow(w);
		const first = parts[0] ?? "";
		expect(await legacy.update(first, lunch(w, { title: "Part" }))).toEqual({
			ok: true,
		});
		expect(await legacy.delete(first)).toEqual({ ok: true });
		expect(await stored(first)).toBeNull();
		expect((await stored(parent))?.children).toHaveLength(parts.length - 1);

		const feeId = await feeRow(w.userId);
		const legs = () =>
			fixtureDb.accountLeg.count({ where: { expenseId: feeId } });
		expect(await legs()).toBe(1);
		expect(await legacy.delete(feeId)).toEqual({ ok: true });
		expect(await stored(feeId)).toBeNull();
		expect(await legs()).toBe(0);
	});
});
