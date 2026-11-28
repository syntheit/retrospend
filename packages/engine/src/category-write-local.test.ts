/**
 * The category writes on the store: what one write refuses and the rows it
 * leaves. The vectors (category-vectors.ts) hold the whole path to the
 * server's; these pin each guard by itself. Pulled: "Food" (id 1, v2, teal,
 * counted) and "Bills" (id 2, v0).
 */
import { CategoryChangedError } from "@retrospend/domain/category-version";
import { IdTakenError } from "@retrospend/domain/id-taken";
import { describe, expect, it } from "vitest";
import { seededCategoryStore } from "./category-conformance";
import { ARS, uuid } from "./category-vector-types";
import {
	CategoryNameTakenError,
	CategoryVersionUnknownError,
	createCategory,
	nameTaken,
	updateCategory,
} from "./category-write-local";
import { NotFoundError } from "./errors";
import { LocalDb } from "./local-db";
import { InvalidInputError } from "./port";

const [FOOD, BILLS, NEW] = [uuid(1), uuid(2), uuid(3)];

async function open() {
	const store = await seededCategoryStore({
		seed: ARS,
		categories: [
			{ id: FOOD, name: "Food", color: "teal", kind: "EXPENSE", version: 2 },
			{ id: BILLS, name: "Bills", color: "blue", kind: "EXPENSE" },
		],
	});
	return { store, db: new LocalDb(store) };
}

const create = (db: LocalDb, id: string, name: string) =>
	db.write("category.create", createCategory({ id, name, color: "pink" }));

describe("category.create", () => {
	it("stores the category under the id it was given, as version 0, and returns the row", async () => {
		const { store, db } = await open();
		const { value } = await create(db, NEW, "Gifts ");
		expect(store.get("categories", NEW)).toEqual({
			id: NEW,
			kind: "EXPENSE",
			name: "Gifts ",
			color: "pink",
			icon: null,
			excludeByDefault: false,
			version: 0,
		});
		expect(value.id).toBe(NEW);
	});

	it("refuses an id the store holds as taken, whatever the name, and changes nothing", async () => {
		const { store, db } = await open();
		const error = await create(db, FOOD, "Other").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(IdTakenError);
		expect(store.get("categories", FOOD)?.name).toBe("Food");
		expect(store.list("categories")).toHaveLength(2);
	});

	it("checks the id before the name: an id taken with a name taken is id taken", async () => {
		const { db } = await open();
		const error = await create(db, FOOD, "Food").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(IdTakenError);
	});

	it("refuses a name the store holds, trimmed, with case counting", async () => {
		const { db } = await open();
		await expect(create(db, NEW, "Food ")).rejects.toBeInstanceOf(
			CategoryNameTakenError,
		);
		await expect(create(db, NEW, "food")).resolves.toBeDefined();
	});

	it("is checked before anything else: a body the schema refuses is the schema's first issue", async () => {
		const { db } = await open();
		await expect(create(db, "nope", "Food")).rejects.toThrow("Invalid UUID");
		await expect(create(db, NEW, "   ")).rejects.toBeInstanceOf(
			InvalidInputError,
		);
	});
});

describe("category.update", () => {
	it("never changes a category's kind: a body that names one is refused", async () => {
		const { store, db } = await open();
		const error = await db
			.write(
				"category.update",
				updateCategory({ id: FOOD, kind: "income", color: "red" }),
			)
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(InvalidInputError);
		expect((error as Error).message).toBe(
			"A category's kind cannot be changed",
		);
		expect(store.get("categories", FOOD)).toMatchObject({
			kind: "EXPENSE",
			color: "teal",
		});
	});

	it("is refused for a category that is not there, and for a version the caller did not read", async () => {
		const { store, db } = await open();
		await expect(
			db.write("category.update", updateCategory({ id: NEW, color: "red" })),
		).rejects.toBeInstanceOf(NotFoundError);
		await expect(
			db.write(
				"category.update",
				updateCategory({ id: FOOD, color: "red", expectedVersion: 1 }),
			),
		).rejects.toBeInstanceOf(CategoryChangedError);
		expect(store.get("categories", FOOD)?.version).toBe(2);
		await db.write(
			"category.update",
			updateCategory({ id: FOOD, color: "red", expectedVersion: 2 }),
		);
		expect(store.get("categories", FOOD)).toMatchObject({
			color: "red",
			version: 3,
		});
	});

	it("moves the version once for a rename with a color, never for a no-change, and by one for the same name sent", async () => {
		const { store, db } = await open();
		const edit = (changes: Parameters<typeof updateCategory>[0]) =>
			db.write("category.update", updateCategory(changes));
		await edit({ id: FOOD, color: "teal" });
		expect(store.get("categories", FOOD)?.version).toBe(2);
		await edit({ id: FOOD, name: "Food" });
		expect(store.get("categories", FOOD)?.version).toBe(3);
		await edit({ id: FOOD, name: "Meals", color: "red" });
		expect(store.get("categories", FOOD)?.version).toBe(4);
	});

	it("lets a category keep its own name in another spacing, and refuses another's", async () => {
		const { store, db } = await open();
		await db.write(
			"category.update",
			updateCategory({ id: FOOD, name: "Food " }),
		);
		expect(store.get("categories", FOOD)?.name).toBe("Food ");
		await expect(
			db.write("category.update", updateCategory({ id: BILLS, name: "Food" })),
		).rejects.toBeInstanceOf(CategoryNameTakenError);
	});
});

describe("a category the device holds with no version", () => {
	// A row an older build pulled, before the server sent a version: it reads
	// back with none, and an edit would book NaN and send no expectedVersion.
	async function unversioned() {
		const { store, db } = await open();
		const { version: _gone, ...bare } = store.get(
			"categories",
			FOOD,
		) as never as {
			version: number;
		} & Record<string, unknown>;
		await store.transaction((tx) => tx.put("categories", bare as never));
		return { store, db };
	}

	it("is not edited: the write is refused as sync first and nothing changes", async () => {
		const { store, db } = await unversioned();
		const before = store.get("categories", FOOD);
		const error = await db
			.write("category.update", updateCategory({ id: FOOD, color: "red" }))
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(CategoryVersionUnknownError);
		expect((error as Error).message).toBe("Sync first");
		expect(store.get("categories", FOOD)).toEqual(before);
	});

	it("is not a fault on the engine: the booking is refused, so the entry carries none", async () => {
		const { isDeviceRefusal } = await import("./device/book");
		expect(isDeviceRefusal(new CategoryVersionUnknownError())).toBe(true);
	});

	it("does not stop a create or the edit of a category that has a version", async () => {
		const { db } = await unversioned();
		await expect(create(db, NEW, "Gifts")).resolves.toBeDefined();
		await expect(
			db.write("category.update", updateCategory({ id: BILLS, color: "red" })),
		).resolves.toBeDefined();
	});
});

describe("the name check", () => {
	it("is the domain's rule over every category the store holds, the one named aside", async () => {
		const { db } = await open();
		const reads = await db.preview((r) => ({
			trimmed: nameTaken(r, " Food  "),
			cased: nameTaken(r, "FOOD"),
			self: nameTaken(r, "Food", FOOD),
		}));
		expect(reads.value).toEqual({ trimmed: true, cased: false, self: false });
	});
});
