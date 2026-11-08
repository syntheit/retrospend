/**
 * The conformance suite every Store must pass: the in-memory one today, the
 * SQLCipher one on the phone later (L1). It is a list of cases, not tied to a
 * test runner: register each with `it(c.name, () => c.run(makeStore))`. A case
 * throws when the store misbehaves. `makeStore` returns a fresh, empty store.
 *
 * It covers the port's contract only (rows, transactions, snapshots). What a
 * persistence layer adds, such as surviving a restart or failing a write
 * halfway, is that store's own tests.
 */
import { fixtureRow } from "./fixtures";
import { type Store, TABLE_NAMES, TransactionError } from "./port";

export interface ConformanceCase {
	name: string;
	run(makeStore: () => Store | Promise<Store>): Promise<void>;
}

/** Rows compared by value: keys sorted, dates as ISO text. */
function canon(value: unknown): string {
	return JSON.stringify(value, (_k, v: unknown) =>
		v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)
			? Object.fromEntries(
					Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)),
				)
			: v,
	);
}

function expectEqual(actual: unknown, expected: unknown, what: string) {
	if (canon(actual) !== canon(expected))
		throw new Error(
			`${what}: expected ${canon(expected)}, got ${canon(actual)}`,
		);
}

async function expectThrows(fn: () => unknown, what: string) {
	try {
		await fn();
	} catch (e) {
		if (e instanceof TransactionError) return;
		throw new Error(`${what}: threw ${String(e)}, not a TransactionError`);
	}
	throw new Error(`${what}: did not throw`);
}

const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id);

export const conformanceCases: ConformanceCase[] = [
	{
		name: "a new store is empty in every table",
		async run(makeStore) {
			const store = await makeStore();
			for (const t of TABLE_NAMES) expectEqual(store.list(t), [], t);
		},
	},
	{
		name: "put, get, replace and delete work in every table",
		async run(makeStore) {
			const store = await makeStore();
			for (const t of TABLE_NAMES) {
				const row = fixtureRow(t, "a");
				await store.transaction((tx) => tx.put(t, row));
				expectEqual(store.get(t, "a"), row, `${t} get`);
				expectEqual(store.list(t), [row], `${t} list`);
				const other = fixtureRow(t, "b");
				await store.transaction((tx) => tx.put(t, other));
				await store.transaction((tx) => tx.put(t, row));
				expectEqual(
					ids(store.list(t)),
					["a", "b"],
					`${t} replace keeps one row`,
				);
				const existed = await store.transaction((tx) => tx.delete(t, "a"));
				expectEqual(existed, true, `${t} delete existing`);
				const again = await store.transaction((tx) => tx.delete(t, "a"));
				expectEqual(again, false, `${t} delete missing`);
				expectEqual(store.get(t, "a"), undefined, `${t} gone`);
				expectEqual(ids(store.list(t)), ["b"], `${t} other stays`);
			}
		},
	},
	{
		name: "lists come back ordered by id",
		async run(makeStore) {
			const store = await makeStore();
			await store.transaction((tx) => {
				for (const id of ["c", "a", "b"])
					tx.put("rates", fixtureRow("rates", id));
			});
			expectEqual(ids(store.list("rates")), ["a", "b", "c"], "order");
		},
	},
	{
		name: "a transaction reads its own writes and the store does not until commit",
		async run(makeStore) {
			const store = await makeStore();
			await store.transaction((tx) =>
				tx.put("rates", fixtureRow("rates", "old")),
			);
			const tx = await store.begin();
			tx.put("rates", fixtureRow("rates", "new"));
			tx.delete("rates", "old");
			expectEqual(ids(tx.list("rates")), ["new"], "tx list");
			expectEqual(tx.get("rates", "old"), undefined, "tx get deleted");
			expectEqual(ids(store.list("rates")), ["old"], "store before commit");
			await tx.commit();
			expectEqual(ids(store.list("rates")), ["new"], "store after commit");
		},
	},
	{
		name: "rollback leaves the store untouched",
		async run(makeStore) {
			const store = await makeStore();
			await store.transaction((tx) =>
				tx.put("rates", fixtureRow("rates", "keep")),
			);
			const tx = await store.begin();
			tx.put("rates", fixtureRow("rates", "drop"));
			tx.delete("rates", "keep");
			tx.rollback();
			expectEqual(ids(store.list("rates")), ["keep"], "after rollback");
		},
	},
	{
		name: "a callback that throws rolls back",
		async run(makeStore) {
			const store = await makeStore();
			await store
				.transaction((tx) => {
					tx.put("rates", fixtureRow("rates", "x"));
					throw new Error("boom");
				})
				.catch(() => undefined);
			expectEqual(store.list("rates"), [], "after throw");
		},
	},
	{
		name: "a snapshot keeps the state it was taken at",
		async run(makeStore) {
			const store = await makeStore();
			await store.transaction((tx) =>
				tx.put("rates", fixtureRow("rates", "a")),
			);
			const snap = store.snapshot();
			await store.transaction((tx) => {
				tx.put("rates", fixtureRow("rates", "b"));
				tx.delete("rates", "a");
			});
			expectEqual(ids(snap.list("rates")), ["a"], "snapshot");
			expectEqual(ids(store.list("rates")), ["b"], "store");
		},
	},
	{
		name: "transactions started together run in call order and see each other's commits",
		async run(makeStore) {
			const store = await makeStore();
			const seen: number[] = [];
			const run = (id: string) =>
				store.transaction(async (tx) => {
					seen.push(tx.list("rates").length);
					await Promise.resolve();
					tx.put("rates", fixtureRow("rates", id));
				});
			await Promise.all([run("a"), run("b"), run("c")]);
			expectEqual(seen, [0, 1, 2], "rows seen at start");
			expectEqual(ids(store.list("rates")), ["a", "b", "c"], "all committed");
		},
	},
	{
		name: "a savepoint commits into its parent and rolls back alone",
		async run(makeStore) {
			const store = await makeStore();
			const tx = await store.begin();
			tx.put("rates", fixtureRow("rates", "parent"));
			const kept = tx.savepoint();
			kept.put("rates", fixtureRow("rates", "kept"));
			await kept.commit();
			const dropped = tx.savepoint();
			dropped.put("rates", fixtureRow("rates", "dropped"));
			expectEqual(
				ids(dropped.list("rates")),
				["dropped", "kept", "parent"],
				"child view",
			);
			dropped.rollback();
			expectEqual(ids(store.list("rates")), [], "store before parent commit");
			await tx.commit();
			expectEqual(
				ids(store.list("rates")),
				["kept", "parent"],
				"after parent commit",
			);
		},
	},
	{
		name: "a parent is unusable while its savepoint is open",
		async run(makeStore) {
			const store = await makeStore();
			const tx = await store.begin();
			const child = tx.savepoint();
			await expectThrows(() => tx.list("rates"), "parent read");
			child.rollback();
			tx.list("rates");
			tx.rollback();
		},
	},
	{
		name: "an ended transaction throws",
		async run(makeStore) {
			const store = await makeStore();
			const done = await store.begin();
			await done.commit();
			await expectThrows(
				() => done.put("rates", fixtureRow("rates", "x")),
				"put",
			);
			await expectThrows(() => done.list("rates"), "list");
			await expectThrows(() => done.commit(), "commit");
			const dropped = await store.begin();
			dropped.rollback();
			dropped.rollback();
			await expectThrows(() => dropped.get("rates", "x"), "get");
		},
	},
];
