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
 *   a sealed value in any top-level write          -> refused before the query (bad_plaintext)
 *   inside verbatim, the row's own sealed cell     -> written as it is
 *   inside verbatim, another row's or column's cell -> FieldCryptoError auth_failed
 *   inside verbatim, no row id, another owner, no user -> bad_plaintext
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insideTransaction, verbatim } from "../db-tx";
import { KeystoreError } from "../services/keys/keystore-errors";
import { loadEpoch, resetEpochForTests, setEpochReader } from "./epoch";
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
const relation = (name: string, type: string) => ({
	name,
	kind: "object",
	type,
});
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
		IdempotencyKey: {
			fields: [scalar("id"), scalar("userId"), scalar("responseBody")],
		},
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

	it("does the same inside a nested select under include, and for an omitted id and owner", async () => {
		const user = ring(1);
		const handle = handlerFor(keysWith({ user }));
		let sent: unknown;
		const result = await handle({
			model: "Expense",
			operation: "findMany",
			args: {
				omit: { id: true, userId: true },
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
		expect(result).toEqual([{ title: "Coffee", category: { name: "Food" } }]);
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

	it("runs updateMany with plaintext or null in a mapped column (PR 4.2 refuses the plaintext)", async () => {
		for (const [model, data] of [
			["Expense", { title: "x" }],
			["Expense", { title: null }],
			["Expense", { amount: 1 }],
			// shared-expenses/transaction.service.ts clears a reason this way.
			["SplitParticipant", { rejectionReason: null }],
		] as const) {
			const query = vi.fn(async () => ({ count: 1 }));
			await handle({
				model,
				operation: "updateMany",
				args: { where: {}, data },
				query,
			});
			expect(query).toHaveBeenCalled();
		}
	});

	it("refuses a sealed value written as text in every top-level write", async () => {
		for (const [operation, args] of [
			["create", { data: { title: sealed } }],
			["update", { where: { id: "e1" }, data: { title: { set: sealed } } }],
			[
				"upsert",
				{ where: { id: "e1" }, create: {}, update: { title: sealed } },
			],
			["createMany", { data: [{ title: "ok" }, { title: sealed }] }],
			["createManyAndReturn", { data: { title: sealed } }],
			["updateMany", { where: {}, data: { title: sealed } }],
			["updateManyAndReturn", { where: {}, data: { title: { set: sealed } } }],
		] as const) {
			const failure = await refused(operation, args);
			expect(failure, operation).toBeInstanceOf(FieldCryptoError);
			expect((failure as FieldCryptoError).code, operation).toBe(
				"bad_plaintext",
			);
		}
	});

	describe("inside verbatim", () => {
		const user = ring(1);
		const instance = ring(1);
		const keys = keysWith({ user, instance });
		const inside = handlerFor(keys);
		const run = (operation: string, model: string, args: unknown) => {
			const query = vi.fn(async () => ({}));
			return verbatim(() =>
				inside({ model, operation, args, query }).then(
					() => query.mock.calls.length > 0,
				),
			);
		};
		const ownProject = sealField(
			instance,
			"Viaje",
			cell("project", "name", "p1"),
		);
		const ownTitle = sealField(user, "Taxi", cell("expense", "title", "e1"));

		it("stores a cell sealed for the very row and column it is written to", async () => {
			await keys.ready();
			expect(
				await run("update", "Project", {
					where: { id: "p1" },
					data: { name: ownProject },
				}),
			).toBe(true);
			expect(
				await run("createMany", "Expense", {
					data: [{ id: "e1", userId: ME, title: ownTitle }],
				}),
			).toBe(true);
			expect(
				await run("update", "Expense", {
					where: { id: "e1" },
					data: { title: "Taxi" },
				}),
			).toBe(true);
			expect(
				await run("upsert", "Project", {
					where: { id: "p1" },
					create: { id: "p1", name: ownProject },
					update: { name: ownProject },
				}),
			).toBe(true);
		});

		it("refuses a cell sealed for another row or column", async () => {
			await keys.ready();
			for (const [operation, model, args] of [
				[
					"update",
					"Project",
					{ where: { id: "p2" }, data: { name: ownProject } },
				],
				[
					"update",
					"Project",
					{ where: { id: "p1" }, data: { description: ownProject } },
				],
				[
					"create",
					"Expense",
					{ data: { id: "e2", userId: ME, title: ownTitle } },
				],
			] as const) {
				const failure = await run(operation, model, args).catch((e) => e);
				expect(failure, `${model}.${operation}`).toBeInstanceOf(
					FieldCryptoError,
				);
				expect((failure as FieldCryptoError).code).toBe("auth_failed");
			}
		});

		it("refuses a sealed value it cannot bind to a row of its own", async () => {
			await keys.ready();
			const global = handlerFor(keysWith({ instance }, null));
			for (const write of [
				// No row id.
				() =>
					run("updateMany", "Project", {
						where: {},
						data: { name: ownProject },
					}),
				() => run("create", "Project", { data: { name: ownProject } }),
				// An upsert whose create half names no id inserts a new one,
				// never the where's p1.
				() =>
					run("upsert", "Project", {
						where: { id: "p1" },
						create: { name: ownProject },
						update: {},
					}),
				// A user-class cell for another owner, or with no user at all.
				() =>
					run("create", "Expense", {
						data: { id: "e1", userId: OTHER, title: ownTitle },
					}),
				() =>
					verbatim(() =>
						global({
							model: "Expense",
							operation: "update",
							args: { where: { id: "e1" }, data: { title: ownTitle } },
							query: async () => ({}),
						}),
					),
			]) {
				const failure = await write().catch((e) => e);
				expect(failure).toBeInstanceOf(FieldCryptoError);
				expect((failure as FieldCryptoError).code).toBe("bad_plaintext");
			}
		});

		it("is a scope: outside it the same own cell is refused", async () => {
			const failure = await inside({
				model: "Project",
				operation: "update",
				args: { where: { id: "p1" }, data: { name: ownProject } },
				query: async () => ({}),
			}).catch((e) => e);
			expect((failure as FieldCryptoError).code).toBe("bad_plaintext");
		});
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
	describe("filters on a mapped column", () => {
		afterEach(() => {
			resetEpochForTests();
			setEpochReader(async () => false);
		});
		const filter = { where: { title: "Rent" } };

		it("run before the epoch exists", async () => {
			const query = vi.fn(async () => []);
			await handle({
				model: "Expense",
				operation: "findMany",
				args: filter,
				query,
			});
			expect(query).toHaveBeenCalled();
		});

		it("are refused once it exists, before the query runs", async () => {
			resetEpochForTests(true);
			for (const operation of [
				"findMany",
				"count",
				"updateMany",
				"deleteMany",
				"groupBy",
			])
				expect(
					((await refused(operation, filter)) as FieldCryptoError).code,
				).toBe("filter_on_sealed");
		});

		it("look only at the cached epoch inside a transaction, an unknown one counting as set", async () => {
			let set = false;
			const read = vi.fn(async () => set);
			setEpochReader(read);
			const query = vi.fn(async () => []);
			const inTransaction = () =>
				insideTransaction(() =>
					handle({
						model: "Expense",
						operation: "findMany",
						args: filter,
						query,
					}),
				);
			await expect(inTransaction()).rejects.toMatchObject({
				code: "filter_on_sealed",
			});
			expect(read).not.toHaveBeenCalled();
			// Loaded outside as not set: the transaction keeps that answer.
			expect(await loadEpoch()).toBe(false);
			set = true;
			await inTransaction();
			expect(query).toHaveBeenCalledTimes(1);
			expect(read).toHaveBeenCalledTimes(1);
		});
	});
});

describe("a JSON body cell", () => {
	const body = (r: Keyring, value: unknown, rowId: string) => ({
		sealed: sealField(
			r,
			JSON.stringify(value),
			cell("idempotency_key", "responseBody", rowId),
		),
	});
	const read = (keys: TextKeys, row: unknown, args: unknown = {}) =>
		handlerFor(keys)({
			model: "IdempotencyKey",
			operation: "findUnique",
			args,
			query: async () => row,
		});

	it("opens the owner's body to its value, passes plaintext, and adds the id and owner to a select", async () => {
		const user = ring(1);
		const value = { id: "a1", name: "Caja fuerte" };
		const query = vi.fn(async () => ({
			id: "k1",
			userId: ME,
			responseBody: body(user, value, "k1"),
		}));
		const result = await handlerFor(keysWith({ user }))({
			model: "IdempotencyKey",
			operation: "findUnique",
			args: { where: { id: "k1" }, select: { responseBody: true } },
			query,
		});
		expect(query).toHaveBeenCalledWith({
			where: { id: "k1" },
			select: { responseBody: true, id: true, userId: true },
		});
		expect(result).toEqual({ responseBody: value });
		const plain = { id: "k2", userId: ME, responseBody: { name: "Plain" } };
		expect(await read(keysWith({ user }), plain)).toEqual(plain);
	});

	it("reads as null for another owner, listed as unavailable and never tried", async () => {
		const load = vi.fn(async () => ring(1));
		const result = (await read(keysWith({ user: load }), {
			id: "k1",
			userId: OTHER,
			responseBody: body(ring(1), { name: "Theirs" }, "k1"),
		})) as object;
		expect(result).toEqual({ id: "k1", userId: OTHER, responseBody: null });
		expect(unavailableFields(result)).toEqual(["responseBody"]);
		expect(load).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledWith("encrypted_text_unavailable", {
			table: "idempotency_key",
			column: "responseBody",
		});
	});

	it("fails a body sealed for another row", async () => {
		const user = ring(1);
		const failure = await read(keysWith({ user }), {
			id: "k1",
			userId: ME,
			responseBody: body(user, { name: "Moved" }, "k2"),
		}).catch((e: unknown) => e);
		expect((failure as FieldCryptoError).code).toBe("auth_failed");
	});

	it("refuses a sealed body as a write's plaintext, and in verbatim takes only the row's own", async () => {
		const user = ring(1);
		const keys = keysWith({ user });
		const handle = handlerFor(keys);
		const write = (rowId: string, sealedFor: string) => {
			const query = vi.fn(async () => ({}));
			return handle({
				model: "IdempotencyKey",
				operation: "update",
				args: {
					where: { id: rowId },
					data: { responseBody: body(user, { a: 1 }, sealedFor) },
				},
				query,
			}).then(
				() => query.mock.calls.length > 0,
				(e: { code?: string }) => e.code,
			);
		};
		expect(await write("k1", "k1")).toBe("bad_plaintext");
		await keys.ready();
		expect(await verbatim(() => write("k1", "k1"))).toBe(true);
		expect(await verbatim(() => write("k1", "k2"))).toBe("auth_failed");
	});
});
