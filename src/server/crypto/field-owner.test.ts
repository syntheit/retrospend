/**
 * The owner column and `nullWhenHidden` of the field map (E2EE D11 PR 3b.0),
 * on a test-only model that no real map entry uses yet: a ghost person owned
 * by `createdById` (relation `createdBy`), with an email and a phone that read
 * null when hidden and a label that reads "". Hand-derived expectations:
 *
 *   own ghost, creator's ring                      -> plaintext
 *   another creator's ghost, or the global client  -> email and phone null, label "", all three listed unavailable, none tried
 *   select { email } with no id or createdById     -> both added for the query, gone from the result, no `userId` added
 *   create naming createdById or createdBy.connect -> sealed under the AAD of the new id
 *   create naming only `userId`, or another creator -> foreign_owner
 *   verbatim create with createdById = the client  -> stored as given; another creator or `userId` -> bad_plaintext
 *   models with no owner entry                      -> userId and user, as before
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verbatim } from "../db-tx";
import {
	FieldCryptoError,
	Keyring,
	openField,
	sealField,
} from "./field-crypto";
import { fieldOpenSlot, unavailableFields } from "./field-open";
import {
	addModelsForTests,
	keyClassOfColumn,
	nullWhenHidden,
	ownerOfModel,
	ownerOfTable,
} from "./fields";
import { buildModelGraph } from "./model-graph";
import { setSealingForTests } from "./sealing";
import { resetReloadsForTests, type TextKeys, textKeys } from "./text-keys";

const ME = "user-me";
const OTHER = "user-other";

const scalar = (name: string) => ({ name, kind: "scalar", type: "String" });
const relation = (name: string, type: string) => ({
	name,
	kind: "object",
	type,
});

let removeModels: () => void;
let graph: ReturnType<typeof buildModelGraph>;
beforeEach(() => {
	resetReloadsForTests();
	vi.spyOn(console, "warn").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
	removeModels = addModelsForTests({
		Ghost: {
			table: "ghost_person",
			columns: { email: "user", phone: "user", label: "user" },
			owner: { column: "createdById", relation: "createdBy" },
			nullWhenHidden: ["email", "phone"],
		},
	});
	graph = buildModelGraph({
		models: {
			Ghost: {
				fields: [
					scalar("id"),
					scalar("createdById"),
					scalar("email"),
					scalar("phone"),
					scalar("label"),
					relation("createdBy", "User"),
				],
			},
			Expense: { fields: [scalar("id"), scalar("userId"), scalar("title")] },
			User: { fields: [scalar("id")] },
		},
	});
});
afterEach(() => {
	removeModels();
	setSealingForTests();
	vi.restoreAllMocks();
});

type Handler = (call: {
	model: string;
	operation: string;
	args: unknown;
	query: (args: unknown) => Promise<unknown>;
}) => Promise<unknown>;

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

const ring = () => new Keyring([{ id: 1, key: randomBytes(32) }]);
const keysFor = (user: Keyring, userId: string | null = ME) =>
	textKeys({ user: () => Promise.resolve(user) }, userId ?? undefined);
const aad = (column: string, rowId: string) => ({
	table: "ghost_person",
	column,
	rowId,
});

describe("the owner lookups", () => {
	it("name createdById for the test model and userId for everything else", () => {
		expect(ownerOfModel("Ghost")).toEqual({
			column: "createdById",
			relation: "createdBy",
		});
		expect(ownerOfTable("ghost_person").column).toBe("createdById");
		expect(ownerOfModel("Expense")).toEqual({
			column: "userId",
			relation: "user",
		});
		expect(ownerOfTable("expense").column).toBe("userId");
		// A JSON-only model is not in the map: the default.
		expect(ownerOfTable("idempotency_key").column).toBe("userId");
		expect(nullWhenHidden("ghost_person", "email")).toBe(true);
		expect(nullWhenHidden("ghost_person", "label")).toBe(false);
		expect(nullWhenHidden("expense", "title")).toBe(false);
		expect(keyClassOfColumn("ghost_person", "phone")).toBe("user");
	});

	it("forget the test model once it is removed", () => {
		removeModels();
		expect(ownerOfTable("ghost_person").column).toBe("userId");
		expect(keyClassOfColumn("ghost_person", "email")).toBeUndefined();
	});
});

describe("opening a cell whose owner column is not userId", () => {
	const sealedGhost = (user: Keyring, creator: string) => ({
		id: "g1",
		createdById: creator,
		email: sealField(user, "bob@example.com", aad("email", "g1")),
		phone: sealField(user, "+54 11 5555 0000", aad("phone", "g1")),
		label: sealField(user, "Bob", aad("label", "g1")),
	});
	const find = (handle: Handler, row: unknown, args: unknown = {}) =>
		handle({
			model: "Ghost",
			operation: "findFirst",
			args,
			query: async () => row,
		}) as Promise<Record<string, unknown>>;

	it("opens the creator's own ghost with the creator's ring", async () => {
		const user = ring();
		const result = await find(handlerFor(keysFor(user)), sealedGhost(user, ME));
		expect(result).toEqual({
			id: "g1",
			createdById: ME,
			email: "bob@example.com",
			phone: "+54 11 5555 0000",
			label: "Bob",
		});
		expect(unavailableFields(result)).toEqual([]);
	});

	it("hides another creator's ghost: null for flagged columns, an empty string for the rest", async () => {
		const user = ring();
		const result = await find(
			handlerFor(keysFor(user)),
			sealedGhost(ring(), OTHER),
		);
		expect(result.email).toBeNull();
		expect(result.phone).toBeNull();
		expect(result.label).toBe("");
		expect(unavailableFields(result)).toEqual(["email", "phone", "label"]);
	});

	it("hides every cell on the global client, which holds no user key", async () => {
		const result = await find(
			handlerFor(keysFor(ring(), null)),
			sealedGhost(ring(), ME),
		);
		expect([result.email, result.phone, result.label]).toEqual([
			null,
			null,
			"",
		]);
	});

	it("passes plaintext of another creator's ghost untouched", async () => {
		const row = { id: "g2", createdById: OTHER, email: "legacy@example.com" };
		expect(await find(handlerFor(keysFor(ring())), row)).toEqual(row);
	});

	it("adds id and createdById to a select, never userId, and removes them again", async () => {
		const user = ring();
		let sent: unknown;
		const result = await handlerFor(keysFor(user))({
			model: "Ghost",
			operation: "findFirst",
			args: { select: { email: true } },
			query: async (a) => {
				sent = a;
				const { id, createdById, email } = sealedGhost(user, ME);
				return { id, createdById, email };
			},
		});
		expect(sent).toEqual({
			select: { email: true, id: true, createdById: true },
		});
		expect(result).toEqual({ email: "bob@example.com" });
	});

	it("fails when the owner column is missing from the row, naming the column in no text", async () => {
		const user = ring();
		const row = {
			...sealedGhost(user, ME),
			createdById: undefined,
			userId: ME,
		};
		await expect(find(handlerFor(keysFor(user)), row)).rejects.toThrow(
			"ghost_person.email cell was read without its owner",
		);
	});

	it("still reads userId on a model that names no owner", async () => {
		const user = ring();
		const result = await handlerFor(keysFor(user))({
			model: "Expense",
			operation: "findFirst",
			args: {},
			query: async () => ({
				id: "e1",
				userId: OTHER,
				title: sealField(user, "Rent", {
					table: "expense",
					column: "title",
					rowId: "e1",
				}),
			}),
		});
		expect(result).toMatchObject({ title: "" });
	});
});

describe("sealing a write whose owner column is not userId", () => {
	const user = ring();
	const create = (data: Record<string, unknown>) => {
		setSealingForTests(() => true);
		let sent: { data: Record<string, unknown> } | undefined;
		const done = handlerFor(keysFor(user))({
			model: "Ghost",
			operation: "create",
			args: { data },
			query: async (a) => {
				sent = a as typeof sent;
				// The database returns the row with its owner column, however the create named it.
				return { ...sent?.data, createdBy: undefined, createdById: ME };
			},
		});
		return { done, sent: () => sent?.data };
	};
	const code = async (promise: Promise<unknown>) => {
		try {
			await promise;
		} catch (error) {
			return (error as FieldCryptoError).code;
		}
		return "none";
	};

	it("seals a create that names createdById, under the new row's id", async () => {
		const { done, sent } = create({
			id: "g9",
			createdById: ME,
			email: "bob@example.com",
		});
		await done;
		const stored = sent()?.email as string;
		expect(stored.startsWith("\u0001k1:")).toBe(true);
		expect(openField(user, stored, aad("email", "g9"))).toBe("bob@example.com");
		// The same cell does not open under another row's AAD.
		expect(() => openField(user, stored, aad("email", "g8"))).toThrow(
			FieldCryptoError,
		);
	});

	it("seals a create that names its creator through createdBy.connect", async () => {
		const { done, sent } = create({
			id: "g10",
			createdBy: { connect: { id: ME } },
			phone: "123",
		});
		await done;
		expect(openField(user, sent()?.phone as string, aad("phone", "g10"))).toBe(
			"123",
		);
	});

	it("refuses a create that names another creator, or only userId", async () => {
		expect(
			await code(
				create({ id: "g11", createdById: OTHER, email: "a@example.com" }).done,
			),
		).toBe("foreign_owner");
		expect(
			await code(
				create({ id: "g12", userId: ME, email: "a@example.com" }).done,
			),
		).toBe("foreign_owner");
		expect(
			await code(
				create({ id: "g13", user: { connect: { id: ME } }, label: "x" }).done,
			),
		).toBe("foreign_owner");
	});

	it("accepts a verbatim create of the client's own sealed cell, and refuses a stranger's", async () => {
		const keys = keysFor(user);
		await keys.ready();
		const handle = handlerFor(keys);
		const own = sealField(user, "bob@example.com", aad("email", "g14"));
		const run = (data: Record<string, unknown>) =>
			verbatim(() =>
				handle({
					model: "Ghost",
					operation: "create",
					args: { data },
					query: async () => ({}),
				}),
			).then(
				() => "stored",
				(error) => (error as FieldCryptoError).code,
			);
		expect(await run({ id: "g14", createdById: ME, email: own })).toBe(
			"stored",
		);
		expect(await run({ id: "g14", createdById: OTHER, email: own })).toBe(
			"bad_plaintext",
		);
		expect(await run({ id: "g14", userId: ME, email: own })).toBe(
			"bad_plaintext",
		);
	});
});
