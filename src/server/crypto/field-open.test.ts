/**
 * The field-open extension's rules, on a fake client (E2EE D11 PR 3.2). The
 * pg tests run the same extension on real clients; these pin each rule with
 * hand-made rings and cells. Hand-derived expectations:
 *
 *   own expense title, user ring holds key 1        -> plaintext
 *   another owner's title, or any on the global client -> "", field listed as unavailable, not tried
 *   select { title } with no id or userId           -> both added for the query, gone from the result
 *   ring lacks the cell's key, reload finds it      -> plaintext, one reload
 *   ring lacks it after the reload                  -> TextUnavailableError keystore_lost
 *   no ring, master key missing                     -> TextUnavailableError master_key_missing
 *   a cell sealed for another row                   -> FieldCryptoError auth_failed
 *   updateMany setting a title, a sealed write      -> refused before the query
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeystoreError } from "../services/keys/keystore-errors";
import {
	type FieldAad,
	FieldCryptoError,
	Keyring,
	sealField,
} from "./field-crypto";
import {
	fieldOpenSlot,
	TextUnavailableError,
	unavailableFields,
} from "./field-open";
import { buildModelGraph } from "./model-graph";
import {
	type KeyLoader,
	resetReloadsForTests,
	type TextKeys,
	textKeys,
} from "./text-keys";

const ME = "user-me";
const OTHER = "user-other";

const scalar = (name: string) => ({ name, kind: "scalar", type: "String" });
const relation = (name: string, type: string) => ({ name, kind: "object", type });
const graph = buildModelGraph({
	models: {
		Expense: {
			fields: [
				scalar("id"),
				scalar("userId"),
				scalar("title"),
				relation("category", "Category"),
			],
		},
		Category: {
			fields: [scalar("id"), scalar("userId"), scalar("name")],
		},
		Project: { fields: [scalar("id"), scalar("name")] },
		ExchangeRate: { fields: [scalar("id"), scalar("currency")] },
	},
});

const ring = (id: number) => new Keyring([{ id, key: randomBytes(32) }]);
const cell = (table: string, column: string, rowId: string): FieldAad => ({
	table,
	column,
	rowId,
});

type Handler = (call: {
	model: string;
	operation: string;
	args: unknown;
	query: (args: unknown) => Promise<unknown>;
}) => Promise<unknown>;

/** The extension's $allOperations, taken from a fake client. */
function handlerFor(keys: TextKeys): Handler {
	let handler: Handler | undefined;
	const fake = {
		$extends(ext: { query: { $allModels: { $allOperations: Handler } } }) {
			handler = ext.query.$allModels.$allOperations;
			return fake;
		},
	};
	(fieldOpenSlot(() => graph) as unknown as (c: unknown, k: TextKeys) => void)(
		fake,
		keys,
	);
	if (!handler) throw new Error("no handler");
	return handler;
}

function keysWith(
	loaders: { user?: Keyring | KeyLoader; instance?: Keyring | KeyLoader },
	userId: string | null = ME,
) {
	const asLoader = (v: Keyring | KeyLoader | undefined) =>
		v instanceof Keyring ? () => Promise.resolve(v) : v;
	return textKeys(
		{ user: asLoader(loaders.user), instance: asLoader(loaders.instance) },
		userId ?? undefined,
	);
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	resetReloadsForTests();
	warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("opening", () => {
	it("opens an own user cell and an instance cell, and passes plaintext", async () => {
		const user = ring(1);
		const instance = ring(1);
		const handle = handlerFor(keysWith({ user, instance }));
		const rows = [
			{
				id: "e1",
				userId: ME,
				title: sealField(user, "Rent", cell("expense", "title", "e1")),
			},
			{ id: "e2", userId: ME, title: "Coffee" },
		];
		const result = await handle({
			model: "Expense",
			operation: "findMany",
			args: {},
			query: async () => rows,
		});
		expect(result).toEqual([
			{ id: "e1", userId: ME, title: "Rent" },
			{ id: "e2", userId: ME, title: "Coffee" },
		]);

		const project = await handle({
			model: "Project",
			operation: "findUnique",
			args: { where: { id: "p1" } },
			query: async () => ({
				id: "p1",
				name: sealField(instance, "Trip", cell("project", "name", "p1")),
			}),
		});
		expect(project).toEqual({ id: "p1", name: "Trip" });
	});

	it("adds id and userId to a select for the query and removes them after", async () => {
		const user = ring(1);
		const handle = handlerFor(keysWith({ user }));
		const args = { where: { id: "e1" }, select: { title: true } };
		let sent: unknown;
		const result = await handle({
			model: "Expense",
			operation: "findFirst",
			args,
			query: async (a) => {
				sent = a;
				return {
					id: "e1",
					userId: ME,
					title: sealField(user, "Rent", cell("expense", "title", "e1")),
				};
			},
		});
		expect(sent).toEqual({
			where: { id: "e1" },
			select: { title: true, id: true, userId: true },
		});
		expect(result).toEqual({ title: "Rent" });
		expect(args).toEqual({ where: { id: "e1" }, select: { title: true } });
	});

	it("does the same inside a nested select under include, and for an omitted id", async () => {
		const user = ring(1);
		const handle = handlerFor(keysWith({ user }));
		let sent: unknown;
		const result = await handle({
			model: "Expense",
			operation: "findMany",
			args: {
				omit: { id: true },
				include: { category: { select: { name: true } } },
			},
			query: async (a) => {
				sent = a;
				return [
					{
						id: "e1",
						userId: ME,
						title: "Coffee",
						category: {
							id: "c1",
							userId: ME,
							name: sealField(user, "Food", cell("category", "name", "c1")),
						},
					},
				];
			},
		});
		expect(sent).toEqual({
			omit: {},
			include: { category: { select: { name: true, id: true, userId: true } } },
		});
		expect(result).toEqual([
			{ userId: ME, title: "Coffee", category: { name: "Food" } },
		]);
	});

	it("leaves results of models with no path to a mapped cell untouched", async () => {
		const handle = handlerFor(keysWith({}));
		const row = { id: "r1", currency: "\u0001k1:junk" };
		const query = vi.fn(async () => row);
		const result = await handle({
			model: "ExchangeRate",
			operation: "findFirst",
			args: {},
			query,
		});
		expect(result).toBe(row);
		expect(query).toHaveBeenCalledWith({});
	});
});

describe("a reader who is not the owner", () => {
	it("gets an empty string and the field listed as unavailable, logged once by column", async () => {
		const user = ring(1);
		const load = vi.fn(async () => user);
		const handle = handlerFor(keysWith({ user: load }));
		const sealed = (id: string) =>
			sealField(ring(1), "Theirs", cell("category", "name", id));
		const rows = [
			{ id: "c1", userId: OTHER, name: sealed("c1") },
			{ id: "c2", userId: OTHER, name: sealed("c2") },
		];
		const result = (await handle({
			model: "Category",
			operation: "findMany",
			args: {},
			query: async () => rows,
		})) as { name: string }[];
		expect(result.map((r) => r.name)).toEqual(["", ""]);
		expect(unavailableFields(result[0] as object)).toEqual(["name"]);
		expect(JSON.stringify(result[0])).toBe(
			JSON.stringify({ id: "c1", userId: OTHER, name: "" }),
		);
		expect(Object.keys(result[0] as object)).toEqual(["id", "userId", "name"]);
		// Not tried: no key was even loaded.
		expect(load).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith("encrypted_text_unavailable", {
			table: "category",
			column: "name",
		});
	});

	it("is everyone on the global client, which has no user", async () => {
		const user = ring(1);
		const handle = handlerFor(keysWith({ instance: ring(1) }, null));
		const result = (await handle({
			model: "Category",
			operation: "findUnique",
			args: {},
			query: async () => ({
				id: "c1",
				userId: ME,
				name: sealField(user, "Mine", cell("category", "name", "c1")),
			}),
		})) as { name: string };
		expect(result.name).toBe("");
		expect(unavailableFields(result)).toEqual(["name"]);
	});

	it("fails a user-class cell read without its owner", async () => {
		const handle = handlerFor(keysWith({ user: ring(1) }));
		await expect(
			handle({
				model: "Category",
				operation: "findUnique",
				args: {},
				query: async () => ({ id: "c1", name: "\u0001k1:AAAA" }),
			}),
		).rejects.toThrow(/without its owner/);
	});
});

describe("keys that are missing or stale", () => {
	it("waits for ready() before the first sealed cell, and only then", async () => {
		const instance = ring(1);
		const load = vi.fn(async () => instance);
		const keys = keysWith({ instance: load }, null);
		const handle = handlerFor(keys);
		const read = (id: string) =>
			handle({
				model: "Project",
				operation: "findUnique",
				args: {},
				query: async () => ({
					id,
					name: sealField(instance, "Trip", cell("project", "name", id)),
				}),
			});
		const results = await Promise.all([read("p1"), read("p2")]);
		expect(results).toEqual([
			{ id: "p1", name: "Trip" },
			{ id: "p2", name: "Trip" },
		]);
		expect(keys.outcome("instance")).toEqual({ ring: instance });
		// Plaintext needs no keys at all.
		load.mockClear();
		await handle({
			model: "Project",
			operation: "findUnique",
			args: {},
			query: async () => ({ id: "p3", name: "Plain" }),
		});
		expect(load).not.toHaveBeenCalled();
	});

	it("reloads once when the ring lacks the cell's key, and opens with the new ring", async () => {
		const old = ring(1);
		const rotated = new Keyring([
			{ id: 2, key: randomBytes(32) },
			{ id: 1, key: randomBytes(32) },
		]);
		const load = vi.fn<KeyLoader>(async (fresh) => (fresh ? rotated : old));
		const keys = keysWith({ instance: load }, null);
		await keys.ready();
		const handle = handlerFor(keys);
		const result = await handle({
			model: "Project",
			operation: "findUnique",
			args: {},
			query: async () => ({
				id: "p1",
				name: sealField(rotated, "Trip", cell("project", "name", "p1")),
			}),
		});
		expect(result).toEqual({ id: "p1", name: "Trip" });
		expect(load.mock.calls).toEqual([[false], [true]]);
	});

	it("fails an own cell with keystore_lost when the reload does not find the key, and throttles the next reload", async () => {
		const load = vi.fn<KeyLoader>(async () => ring(1));
		const keys = keysWith({ user: load });
		const handle = handlerFor(keys);
		const read = () =>
			handle({
				model: "Category",
				operation: "findUnique",
				args: {},
				query: async () => ({
					id: "c1",
					userId: ME,
					name: sealField(ring(9), "Food", cell("category", "name", "c1")),
				}),
			});
		const failure = await read().catch((e: unknown) => e);
		expect(failure).toBeInstanceOf(TextUnavailableError);
		expect((failure as TextUnavailableError).code).toBe("keystore_lost");
		// ready(), then one reload past the cache.
		expect(load.mock.calls).toEqual([[false], [true]]);
		await expect(read()).rejects.toBeInstanceOf(TextUnavailableError);
		expect(load.mock.calls).toEqual([[false], [true]]);
		expect(error).toHaveBeenCalledWith("Sealed text could not be opened", {
			table: "category",
			column: "name",
			code: "keystore_lost",
		});
	});

	it("fails with the recorded code when there is no ring", async () => {
		const keys = keysWith({
			instance: () =>
				Promise.reject(new KeystoreError("master_key_missing", "not set")),
		});
		const handle = handlerFor(keys);
		const failure = await handle({
			model: "Project",
			operation: "findUnique",
			args: {},
			query: async () => ({
				id: "p1",
				name: sealField(ring(1), "Trip", cell("project", "name", "p1")),
			}),
		}).catch((e: unknown) => e);
		expect((failure as TextUnavailableError).code).toBe("master_key_missing");
	});

	it("fails a cell moved from another row, and never hides it", async () => {
		const user = ring(1);
		const handle = handlerFor(keysWith({ user }));
		const failure = await handle({
			model: "Category",
			operation: "findUnique",
			args: {},
			query: async () => ({
				id: "c1",
				userId: ME,
				name: sealField(user, "Food", cell("category", "name", "c2")),
			}),
		}).catch((e: unknown) => e);
		expect(failure).toBeInstanceOf(FieldCryptoError);
		expect((failure as FieldCryptoError).code).toBe("auth_failed");
		expect(error).toHaveBeenCalledWith("Sealed text could not be opened", {
			table: "category",
			column: "name",
			code: "auth_failed",
		});
	});
});

describe("refusals", () => {
	const handle = handlerFor(keysWith({ user: ring(1) }));
	const sealed = "\u0001k1:AAAA";
	const refused = async (operation: string, args: unknown) => {
		const query = vi.fn(async () => ({}));
		const failure = await handle({
			model: "Expense",
			operation,
			args,
			query,
		}).catch((e: unknown) => e);
		expect(query).not.toHaveBeenCalled();
		return failure;
	};

	it("refuses updateMany that sets a mapped column", async () => {
		expect(
			await refused("updateMany", { where: {}, data: { title: "x" } }),
		).toBeInstanceOf(Error);
		expect(
			await refused("updateManyAndReturn", { where: {}, data: { title: null } }),
		).toBeInstanceOf(Error);
		const query = vi.fn(async () => ({ count: 1 }));
		await handle({
			model: "Expense",
			operation: "updateMany",
			args: { where: {}, data: { amount: 1 } },
			query,
		});
		expect(query).toHaveBeenCalled();
	});

	it("refuses a sealed value written as text in every top-level write", async () => {
		for (const [operation, args] of [
			["create", { data: { title: sealed } }],
			["update", { where: { id: "e1" }, data: { title: { set: sealed } } }],
			["upsert", { where: { id: "e1" }, create: {}, update: { title: sealed } }],
			["createMany", { data: [{ title: "ok" }, { title: sealed }] }],
			["createManyAndReturn", { data: { title: sealed } }],
		] as const) {
			const failure = await refused(operation, args);
			expect(failure, operation).toBeInstanceOf(FieldCryptoError);
			expect((failure as FieldCryptoError).code, operation).toBe("bad_plaintext");
		}
	});

	it("refuses an aggregate that returns a sealed value, and passes plaintext", async () => {
		const run = (operation: string, result: unknown) =>
			handle({
				model: "Expense",
				operation,
				args: {},
				query: async () => result,
			});
		await expect(
			run("groupBy", [{ title: sealed, _count: 1 }]),
		).rejects.toThrow(/cannot open/);
		await expect(run("aggregate", { _min: { title: sealed } })).rejects.toThrow(
			/cannot open/,
		);
		expect(await run("groupBy", [{ title: "Rent" }])).toEqual([
			{ title: "Rent" },
		]);
	});
});
