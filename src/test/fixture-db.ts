/**
 * `fixtureDb` for the sealed suite (E2EE D11 PR 4.4, sealed-sweep.ts). A
 * test seeds and inspects a user's rows on the global client, which holds no
 * user key: with sealing on, the seal path refuses its user-class text and a
 * read gets "" for it; and a filter on any mapped column is refused once
 * the epoch is set. Here:
 * - a write of a model with user-class text runs on the row owner's scoped
 *   client, with a category's name index beside its name as category.service
 *   writes it, so the fixture stores what the owner's own write would:
 *   sealed with the owner's key, under RLS;
 * - a read runs on the global client, and the user-class cells it could not
 *   open are read again by their owner's scoped client (top-level rows);
 * - a read or count whose `where` names a mapped column with a string is
 *   matched here, on the opened text, as the app's searches are.
 * Only test code calls it; it is never handed to app code, which keeps the
 * plain global client (`adminDb`), so a service that writes user text on the
 * global client still fails.
 */
import { unavailableFields } from "~/server/crypto/field-open";
import {
	jsonColumns,
	mappedColumns,
	modelOfTable,
} from "~/server/crypto/fields";
import { createUserScopedDb, type db } from "~/server/db";
import { outsideTransaction } from "~/server/db-tx";
import { computeCategoryNameIndex } from "~/server/services/category-name-index.service";
import { ensureUserKeyring } from "~/server/services/keys/data-key.service";

type Row = Record<string, unknown>;
type Client = typeof db;
type Delegate = Record<string, (args: Row) => Promise<unknown>>;

const isRow = (value: unknown): value is Row =>
	typeof value === "object" && value !== null && !Array.isArray(value);

interface Mapped {
	table: string;
	columns: string[];
	userColumns: string[];
}

/** Each client property of a model with mapped columns. */
const MODELS = new Map<string, Mapped>();
for (const [table, column, keyClass] of mappedColumns()) {
	const model = modelOfTable(table) ?? table;
	const key = model.charAt(0).toLowerCase() + model.slice(1);
	const entry = MODELS.get(key) ?? { table, columns: [], userColumns: [] };
	entry.columns.push(column);
	if (keyClass === "user") entry.userColumns.push(column);
	MODELS.set(key, entry);
}
// A user-class JSON cell is sealed with its owner's key like a text cell, so a
// write of one runs as the owner; it is no `columns` entry (a string filter).
// Only models that also hold text columns are proxied.
for (const [table, column, cell] of jsonColumns()) {
	const model = modelOfTable(table);
	if (cell.cls !== "user" || !model) continue;
	const key = model.charAt(0).toLowerCase() + model.slice(1);
	const entry = MODELS.get(key) ?? { table, columns: [], userColumns: [] };
	entry.userColumns.push(column);
	MODELS.set(key, entry);
}
const mapped = (model: string): Mapped =>
	MODELS.get(model) ?? { table: model, columns: [], userColumns: [] };

const WRITES = new Set([
	"create",
	"createMany",
	"createManyAndReturn",
	"upsert",
	"update",
]);
const READS = new Set([
	"findUnique",
	"findUniqueOrThrow",
	"findFirst",
	"findFirstOrThrow",
	"findMany",
	"count",
]);

function call(client: Client, model: string, operation: string, args: Row) {
	const method = (client as unknown as Record<string, Delegate | undefined>)[
		model
	]?.[operation];
	if (!method) throw new Error(`No ${model}.${operation}`);
	return method(args);
}

const ownerOf = (data: unknown): string | undefined => {
	if (!isRow(data)) return undefined;
	if (typeof data.userId === "string") return data.userId;
	const connect = isRow(data.user) ? data.user.connect : undefined;
	return isRow(connect) && typeof connect.id === "string"
		? connect.id
		: undefined;
};

/** The row's owner for a write: its data's, or the stored row's on an update of text. */
async function ownerOfWrite(
	global: Client,
	model: string,
	operation: string,
	args: Row,
): Promise<string | undefined> {
	if (operation === "upsert") return ownerOf(args.create);
	if (operation !== "update") return ownerOf(args.data);
	const { table, userColumns: columns } = mapped(model);
	const id = isRow(args.where) ? args.where.id : undefined;
	const data = isRow(args.data) ? args.data : {};
	if (typeof id !== "string" || !columns.some((c) => data[c] != null))
		return undefined;
	const [row] = await global.$queryRawUnsafe<{ userId: string }[]>(
		`SELECT "userId" FROM "${table}" WHERE "id" = $1`,
		id,
	);
	return row?.userId;
}

/** `args` with every category name given its index under the owner's key. */
async function withNameIndex(
	model: string,
	owner: string | undefined,
	args: Row,
): Promise<Row> {
	if (model !== "category" || !owner) return args;
	const ring = await ensureUserKeyring(owner);
	const fill = (data: unknown) =>
		isRow(data) && typeof data.name === "string" && data.nameIndex === undefined
			? { ...data, nameIndex: computeCategoryNameIndex(ring, data.name) }
			: data;
	const next = { ...args };
	for (const key of ["data", "create", "update"])
		if (next[key] !== undefined)
			next[key] = Array.isArray(next[key])
				? next[key].map(fill)
				: fill(next[key]);
	return next;
}

async function write(
	global: Client,
	model: string,
	operation: string,
	args: Row,
): Promise<unknown> {
	// On a connection of its own, also when a test calls it from inside an
	// app transaction (a concurrent writer): so outside that transaction.
	const run = (owner: string | undefined, callArgs: Row) =>
		outsideTransaction(async () =>
			call(
				owner ? createUserScopedDb(owner) : global,
				model,
				operation,
				await withNameIndex(model, owner, callArgs),
			),
		);
	if (operation !== "createMany" && operation !== "createManyAndReturn")
		return run(await ownerOfWrite(global, model, operation, args), args);
	// One call per owner.
	const byOwner = new Map<string | undefined, unknown[]>();
	for (const data of [args.data].flat())
		byOwner.set(ownerOf(data), [...(byOwner.get(ownerOf(data)) ?? []), data]);
	const results = await Promise.all(
		[...byOwner].map(([owner, data]) => run(owner, { ...args, data })),
	);
	if (operation === "createManyAndReturn") return results.flat();
	let count = 0;
	for (const result of results) count += (result as { count: number }).count;
	return { count };
}

/** Reads the user-class cells the global client left "" with their owner's client. */
async function reopen(model: string, rows: unknown[]): Promise<void> {
	for (const row of rows) {
		if (!isRow(row)) continue;
		const hidden = unavailableFields(row);
		if (hidden.length > 0 && typeof row.userId === "string")
			Object.assign(
				row,
				await call(createUserScopedDb(row.userId), model, "findUnique", {
					where: { id: row.id },
					select: Object.fromEntries(hidden.map((c) => [c, true])),
				}),
			);
	}
}

async function read(
	global: Client,
	model: string,
	operation: string,
	args: Row = {},
): Promise<unknown> {
	const { columns, userColumns } = mapped(model);
	// `where` on a mapped column with a string: matched below, on the text.
	const where = isRow(args.where) ? { ...args.where } : {};
	const text: [string, string][] = [];
	for (const column of columns) {
		const value = where[column];
		if (typeof value !== "string") continue;
		text.push([column, value]);
		delete where[column];
	}
	const filtered = text.length > 0 && !operation.startsWith("findUnique");
	if (operation === "count" && !filtered)
		return call(global, model, operation, args);
	// The id and owner (to read a cell again) and the filtered columns are
	// needed here: asked for, then dropped.
	const needs = [
		"id",
		...(userColumns.length > 0 ? ["userId"] : []),
		...text.map(([column]) => column),
	];
	const select =
		operation === "count" ? {} : isRow(args.select) ? args.select : undefined;
	const added = select ? needs.filter((key) => !select[key]) : [];
	const asked: Row =
		operation === "count"
			? { where }
			: filtered
				? { ...args, where, take: undefined, skip: undefined }
				: { ...args };
	if (select)
		asked.select = {
			...select,
			...Object.fromEntries(needs.map((key) => [key, true])),
		};
	const result = await call(
		global,
		model,
		filtered ? "findMany" : operation,
		asked,
	);
	const list = [result].flat().filter(isRow);
	await reopen(model, list);
	const rows = filtered
		? list.filter((row) =>
				text.every(([column, value]) => row[column] === value),
			)
		: list;
	for (const row of rows) for (const key of added) delete row[key];
	if (!filtered) return result;
	if (operation === "count") return rows.length;
	if (operation === "findMany") {
		const skip = typeof args.skip === "number" ? args.skip : 0;
		const take = typeof args.take === "number" ? args.take : rows.length;
		return rows.slice(skip, skip + take);
	}
	const first = rows[0] ?? null;
	if (!first && operation.endsWith("OrThrow"))
		throw new Error(`No ${model} row matches the text filter`);
	return first;
}

/** `global` with the fixture behavior described at the top of this file. */
export function fixtureClient(global: Client): Client {
	return new Proxy(global, {
		get(target, prop) {
			const value = Reflect.get(target, prop, target);
			if (typeof prop !== "string" || !MODELS.has(prop))
				return typeof value === "function" ? value.bind(target) : value;
			return new Proxy(value as Delegate, {
				get(delegate, operation) {
					const method = Reflect.get(delegate, operation, delegate);
					if (typeof operation !== "string") return method;
					if (WRITES.has(operation) && mapped(prop).userColumns.length > 0)
						return (args: Row) => write(target, prop, operation, args);
					if (READS.has(operation))
						return (args?: Row) => read(target, prop, operation, args);
					return typeof method === "function" ? method.bind(delegate) : method;
				},
			});
		},
	});
}
