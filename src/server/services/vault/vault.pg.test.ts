/**
 * applyVaultWrites and readVaultChanges on real Postgres, as a signed-in user
 * (userTransaction sets the RLS user and the app role), with records sealed by
 * @retrospend/crypto: the version rules, replays, conflicts that do not abort
 * the transaction, two writers on one record, commit order under open
 * transactions (the sync feed's race, with the real stamping trigger), cursors
 * the store cannot honor and the byte caps. Expected values are derived by
 * hand from the writes each test makes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import {
	encodeCursor,
	InvalidCursorError,
} from "~/server/services/api-v1/cursor";
import { SyncResetRequiredError } from "~/server/services/sync/changes";
import { until } from "~/server/services/sync/sync-test-support";
import { createTestUser } from "~/test/pg-harness";
import { VaultError } from "./errors";
import {
	applyVaultWrites,
	readVaultChanges,
	type VaultRecord,
	type VaultWrite,
} from "./vault.service";
import { clearVault, vaultRowsOf } from "./vault-db-support";
import { type Sealer, sealer, writeOf } from "./vault-test-support";

let seal: Sealer;
beforeAll(async () => {
	seal = await sealer();
});
// The rollback test of the table needs it empty, and a worker's database
// outlives the file: leave no vault rows behind.
afterAll(clearVault);

async function newUser() {
	const { user, db } = await createTestUser();
	const run = <T>(work: Parameters<typeof userTransaction<T>>[2]) =>
		userTransaction(db, user.id, work);
	const apply = (writes: VaultWrite[]) =>
		run((tx) => applyVaultWrites(tx, user.id, writes));
	const put = (
		id: string,
		base: number,
		over?: Parameters<typeof writeOf>[4],
	) => writeOf(seal, user.id, id, base, over);
	const read = (cursor?: string, limit = 1000, maxBytes?: number) =>
		run((tx) => readVaultChanges(tx, user.id, cursor, { limit, maxBytes }));
	/** The rows from `cursor`, retried until at least `count` show: the cut waits for older transactions. */
	const readUntil = (count: number, cursor?: string, limit = 1000) =>
		until(
			() => read(cursor, limit),
			(p) => p.records.length >= count,
		);
	return { id: user.id, run, apply, put, read, readUntil };
}

const outcome = (work: Promise<unknown>) =>
	work.then(
		() => "ok" as const,
		(error) =>
			error instanceof VaultError
				? { code: error.code, ids: [...error.ids] }
				: error,
	);
const ids = (records: VaultRecord[]) => records.map((r) => r.id);
const bytesOf = (r: VaultRecord | undefined) =>
	r?.ciphertext ? Buffer.from(r.ciphertext).toString("hex") : null;
const hex = (b: Uint8Array | null) =>
	b ? Buffer.from(b).toString("hex") : null;

/** A transaction that stays open until `release`, after `work` ran in it. */
function held<T>(
	run: ReturnType<typeof newUser>["run"],
	work: Parameters<typeof run<T>>[0],
) {
	let release: () => void = () => undefined;
	const gate = new Promise<void>((r) => {
		release = r;
	});
	let opened: () => void = () => undefined;
	const hasOpened = new Promise<void>((r) => {
		opened = r;
	});
	const done = run(async (tx) => {
		const result = await work(tx);
		opened();
		await gate;
		return result;
	});
	return { opened: hasOpened, release, done };
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("versions", () => {
	it("creates at 0, updates at 1, and returns { id, version } in the order given", async () => {
		const u = await newUser();
		expect(await u.apply([u.put("b", 0), u.put("a", 0)])).toEqual([
			{ id: "b", version: 1 },
			{ id: "a", version: 1 },
		]);
		const write = u.put("a", 1, { record: { note: "second" } });
		expect(await u.apply([write])).toEqual([{ id: "a", version: 2 }]);
		const page = await u.readUntil(2);
		const a = page.records.find((r) => r.id === "a");
		expect(a?.version).toBe(2);
		// The stored bytes are exactly the bytes sent: the server never rewrites a record.
		expect(bytesOf(a)).toBe(hex(write.ciphertext));
		expect(a?.collectionId).toBe("col1");
		expect(a?.entity).toBe(40);
	});

	it("refuses a stale base, an id already taken and an update of nothing, listing every id, and stores none of the batch", async () => {
		const u = await newUser();
		await u.apply([u.put("a", 0), u.put("b", 0), u.put("c", 0)]);
		await u.apply([u.put("a", 1)]); // a is now at 2
		const result = await outcome(
			u.apply([
				u.put("a", 1, { record: { n: 1 } }), // stale: stored is 2
				u.put("b", 0, { record: { n: 2 } }), // taken
				u.put("ghost", 1), // no such record
				u.put("fresh", 0), // would be fine alone
				u.put("c", 1, { record: { n: 3 } }), // fine alone
			]),
		);
		expect(result).toEqual({ code: "conflict", ids: ["a", "b", "ghost"] });
		// All or nothing: "fresh" was not created and "c" is still at 1.
		const rows = await vaultRowsOf(u.id);
		expect(rows.map((r) => `${r.id}:${r.version}`).sort()).toEqual([
			"a:2",
			"b:1",
			"c:1",
		]);
	});

	it("a conflict does not abort the transaction: the caller can still read in it", async () => {
		const u = await newUser();
		await u.apply([u.put("a", 0)]);
		const seen = await u.run(async (tx) => {
			const first = await outcome(applyVaultWrites(tx, u.id, [u.put("a", 0)]));
			// Plain INSERT would have raised 23505 and left this transaction aborted.
			const rows = await tx.$queryRaw<{ n: number }[]>`
				SELECT count(*)::int AS n FROM "vault_record"`;
			return { first, n: rows[0]?.n };
		});
		expect(seen).toEqual({ first: { code: "conflict", ids: ["a"] }, n: 1 });
	});

	it("a tombstone raises the version, clears the bytes and keeps its place; a live write revives it", async () => {
		const u = await newUser();
		await u.apply([u.put("a", 0)]);
		expect(await u.apply([u.put("a", 1, { tombstone: true })])).toEqual([
			{ id: "a", version: 2 },
		]);
		const dead = (await u.readUntil(1)).records[0];
		expect(dead).toMatchObject({ id: "a", version: 2, ciphertext: null });
		expect(dead?.deletedAt).toBeInstanceOf(Date);
		const [row] = await vaultRowsOf(u.id);
		expect(row?.size).toBeNull();

		// Revive: the next version over the tombstone, bytes back, mark gone.
		expect(await u.apply([u.put("a", 2)])).toEqual([{ id: "a", version: 3 }]);
		const alive = (await u.readUntil(1)).records[0];
		expect(alive?.version).toBe(3);
		expect(alive?.deletedAt).toBeNull();
		expect(alive?.ciphertext?.length).toBe(122);
	});

	it("a record never moves: another collection or entity is invalid_input and nothing changes", async () => {
		const u = await newUser();
		await u.apply([u.put("a", 0)]);
		for (const over of [{ collectionId: "col2" }, { entity: 41 }]) {
			expect(await outcome(u.apply([u.put("a", 1, over)]))).toEqual({
				code: "invalid_input",
				ids: [],
			});
		}
		// A create onto a taken id under another collection is the same mistake.
		expect(await outcome(u.apply([u.put("a", 0, { entity: 41 })]))).toEqual({
			code: "invalid_input",
			ids: [],
		});
		expect((await vaultRowsOf(u.id))[0]?.version).toBe(1);
	});

	it("refuses a batch naming one id twice, a tombstone at base 0 and a bad record, before any write", async () => {
		const u = await newUser();
		for (const batch of [
			[u.put("a", 0), u.put("a", 0)],
			[{ ...u.put("a", 0), ciphertext: null }],
			[{ ...u.put("a", 0), ciphertext: new Uint8Array(100) }],
			[u.put("ok", 0), { ...u.put("b", 0), entity: 0 }],
		]) {
			expect(await outcome(u.apply(batch))).toEqual({
				code: "invalid_input",
				ids: [],
			});
		}
		expect(await vaultRowsOf(u.id)).toEqual([]);
	});

	it("takes entity 40000 and the other end of the range", async () => {
		const u = await newUser();
		await u.apply([
			u.put("a", 0, { entity: 40000 }),
			u.put("b", 0, { entity: 65535 }),
			u.put("c", 0, { entity: 1 }),
		]);
		const page = await u.readUntil(3);
		expect(page.records.map((r) => r.entity).sort((x, y) => x - y)).toEqual([
			1, 40000, 65535,
		]);
	});
});

describe("replays", () => {
	it("a write already applied returns its result again and changes nothing: not a conflict, not a new stamp", async () => {
		const u = await newUser();
		const create = u.put("a", 0);
		const update = u.put("a", 1, { record: { n: 2 } });
		const tombstone = u.put("b", 0);
		await u.apply([create, tombstone]);
		await u.apply([update, u.put("b", 1, { tombstone: true })]);
		const before = await vaultRowsOf(u.id);

		// A create sent again after its record moved on is stale, not a replay:
		// only the latest write to a record counts as applied.
		expect(await outcome(u.apply([create]))).toEqual({
			code: "conflict",
			ids: ["a"],
		});

		// The batch again, answer lost: the latest writes are replays.
		expect(await u.apply([update, u.put("b", 1, { tombstone: true })])).toEqual(
			[
				{ id: "a", version: 2 },
				{ id: "b", version: 2 },
			],
		);
		// Nothing was stamped again.
		expect(await vaultRowsOf(u.id)).toEqual(before);
	});

	it("a replayed create returns version 1; a replay in a batch with new writes lets the new ones through", async () => {
		const u = await newUser();
		const create = u.put("a", 0);
		await u.apply([create]);
		expect(await u.apply([create, u.put("b", 0)])).toEqual([
			{ id: "a", version: 1 },
			{ id: "b", version: 1 },
		]);
		expect((await vaultRowsOf(u.id)).map((r) => r.id).sort()).toEqual([
			"a",
			"b",
		]);
	});

	it("the same version with other bytes is a conflict, not a replay", async () => {
		const u = await newUser();
		await u.apply([u.put("a", 0, { record: { n: 1 } })]);
		const other = u.put("a", 0, { record: { n: 2 } });
		expect(await outcome(u.apply([other]))).toEqual({
			code: "conflict",
			ids: ["a"],
		});
		// And a live write is not the replay of a tombstone at the same version.
		await u.apply([u.put("t", 0)]);
		await u.apply([u.put("t", 1, { tombstone: true })]);
		expect(await outcome(u.apply([u.put("t", 1)]))).toEqual({
			code: "conflict",
			ids: ["t"],
		});
	});
});

describe("two writers on one record", () => {
	it("exactly one update wins; the loser gets a conflict and its other writes are rolled back", async () => {
		const u = await newUser();
		await u.apply([u.put("a", 0), u.put("side", 0)]);
		const winner = u.put("a", 1, { record: { who: "winner" } });
		const loser = u.put("a", 1, { record: { who: "loser" } });
		const first = held(u.run, (tx) => applyVaultWrites(tx, u.id, [winner]));
		await first.opened;
		// The second writer blocks on a's row lock until the first commits.
		const second = outcome(
			u.apply([loser, u.put("side", 1, { record: { who: "side" } })]),
		);
		await pause(150);
		first.release();
		await first.done;
		expect(await second).toEqual({ code: "conflict", ids: ["a"] });
		const rows = await vaultRowsOf(u.id);
		expect(rows.map((r) => `${r.id}:${r.version}`).sort()).toEqual([
			"a:2",
			"side:1",
		]);
		const page = await u.readUntil(2);
		expect(bytesOf(page.records.find((r) => r.id === "a"))).toBe(
			hex(winner.ciphertext),
		);
	}, 60_000);

	it("two creates of one id: one wins, the other is a conflict, not an aborted transaction", async () => {
		const u = await newUser();
		const a = u.put("a", 0, { record: { who: "first" } });
		const b = u.put("a", 0, { record: { who: "second" } });
		const first = held(u.run, (tx) => applyVaultWrites(tx, u.id, [a]));
		await first.opened;
		const second = outcome(u.apply([b]));
		await pause(150);
		first.release();
		await first.done;
		expect(await second).toEqual({ code: "conflict", ids: ["a"] });
		expect((await vaultRowsOf(u.id)).length).toBe(1);
	}, 60_000);

	it("two writers sending the same bytes both succeed: the second is a replay", async () => {
		const u = await newUser();
		const write = u.put("a", 0);
		const first = held(u.run, (tx) => applyVaultWrites(tx, u.id, [write]));
		await first.opened;
		const second = u.apply([write]);
		await pause(150);
		first.release();
		await first.done;
		expect(await second).toEqual([{ id: "a", version: 1 }]);
		expect((await vaultRowsOf(u.id)).length).toBe(1);
	}, 60_000);
});

describe("commit order", () => {
	it("a write that commits late is not skipped by a reader that paged in between", async () => {
		const u = await newUser();
		// A starts first and stays open; B starts later and commits first.
		const slow = held(u.run, (tx) =>
			applyVaultWrites(tx, u.id, [u.put("slow", 0)]),
		);
		await slow.opened;
		await u.apply([u.put("fast", 0)]);

		// B is committed but A is open: nothing is shown, so no cursor passes A.
		expect((await u.read()).records).toEqual([]);

		slow.release();
		await slow.done;
		const both = await u.readUntil(2);
		expect(ids(both.records)).toEqual(["slow", "fast"]);
		// Resuming from the first row still finds the second.
		const one = await u.read(undefined, 1);
		expect(ids(one.records)).toEqual(["slow"]);
		expect(one.hasMore).toBe(true);
		const rest = await u.readUntil(1, one.cursor, 1);
		expect(ids(rest.records)).toEqual(["fast"]);
		// (txid, seq) is the order: A's transaction started first.
		const rows = await vaultRowsOf(u.id);
		expect(rows.map((r) => r.id)).toEqual(["slow", "fast"]);
		expect(BigInt(rows[0]?.txid ?? 0)).toBeLessThan(BigInt(rows[1]?.txid ?? 0));
	}, 60_000);

	it("another user's open write holds back this user's newer commit, then both arrive in order", async () => {
		const mine = await newUser();
		const theirs = await newUser();
		const open = held(theirs.run, (tx) =>
			applyVaultWrites(tx, theirs.id, [theirs.put("x", 0)]),
		);
		await open.opened;
		await mine.apply([mine.put("m", 0)]);
		expect((await mine.read()).records).toEqual([]);
		open.release();
		await open.done;
		expect(ids((await mine.readUntil(1)).records)).toEqual(["m"]);
	}, 60_000);

	it("pages of a mixed set return every row once, live and tombstones, in the order written", async () => {
		const u = await newUser();
		const names = ["a", "b", "c", "d", "e", "f", "g"];
		for (const id of names) await u.apply([u.put(id, 0)]);
		await u.apply([u.put("b", 1, { tombstone: true })]);
		// Seven records, "b" rewritten last: b moved to the end as a tombstone.
		const expected = ["a", "c", "d", "e", "f", "g", "b"];
		await u.readUntil(7);

		const pages: VaultRecord[][] = [];
		let cursor: string | undefined;
		for (;;) {
			const page = await u.read(cursor, 3);
			pages.push(page.records);
			if (!page.hasMore) break;
			cursor = page.cursor;
		}
		expect(pages.map((p) => p.length)).toEqual([3, 3, 1]);
		expect(pages.flat().map((r) => r.id)).toEqual(expected);
		expect(pages.flat().at(-1)).toMatchObject({ id: "b", ciphertext: null });
		// The reader's order is the stored (txid, seq) order, and both rise.
		const rows = await vaultRowsOf(u.id);
		expect(rows.map((r) => r.id)).toEqual(expected);
		for (let i = 1; i < rows.length; i++) {
			const [p, c] = [rows[i - 1], rows[i]];
			expect(
				BigInt(c?.txid ?? 0) > BigInt(p?.txid ?? 0) ||
					(c?.txid === p?.txid && BigInt(c?.seq ?? 0) > BigInt(p?.seq ?? 0)),
			).toBe(true);
		}
	}, 60_000);

	it("a batch is stamped in one transaction: one txid, a rising seq in id order", async () => {
		const u = await newUser();
		await u.apply([u.put("c", 0), u.put("a", 0), u.put("b", 0)]);
		const rows = await vaultRowsOf(u.id);
		expect(new Set(rows.map((r) => r.txid)).size).toBe(1);
		expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
		const seqs = rows.map((r) => BigInt(r.seq));
		expect(seqs[0]).toBeLessThan(seqs[1] as bigint);
		expect(seqs[1]).toBeLessThan(seqs[2] as bigint);
	});

	it("a rewrite moves (txid, seq): the record comes again, at its new version, after the cursor", async () => {
		const u = await newUser();
		await u.apply([u.put("r1", 0)]);
		await u.apply([u.put("r2", 0)]);
		const before = await vaultRowsOf(u.id);
		const first = await u.readUntil(2);
		expect(ids(first.records)).toEqual(["r1", "r2"]);

		await u.apply([u.put("r1", 1, { record: { n: 2 } })]);
		const after = await vaultRowsOf(u.id);
		const r1 = (id: string) => after.find((r) => r.id === id);
		const r1Before = before.find((r) => r.id === "r1");
		expect(BigInt(r1("r1")?.txid ?? 0)).toBeGreaterThan(
			BigInt(r1Before?.txid ?? 0),
		);
		expect(BigInt(r1("r1")?.seq ?? 0)).toBeGreaterThan(
			BigInt(r1Before?.seq ?? 0),
		);

		// A row paged past comes back at its new version, once.
		const again = await u.readUntil(1, first.cursor);
		expect(again.records.map((r) => `${r.id}:${r.version}`)).toEqual(["r1:2"]);
		// From the start there are still two rows, r1 now last.
		expect(ids((await u.readUntil(2)).records)).toEqual(["r2", "r1"]);
	}, 60_000);

	it("an update that is open while a reader pages shows the old version now and the new one on a later page", async () => {
		const u = await newUser();
		await u.apply([u.put("a", 0)]);
		const old = await u.readUntil(1);
		expect(old.records[0]?.version).toBe(1);

		const writer = held(u.run, (tx) =>
			applyVaultWrites(tx, u.id, [u.put("a", 1, { record: { n: 2 } })]),
		);
		await writer.opened;
		const during = await u.read();
		expect(during.records.map((r) => `${r.id}:${r.version}`)).toEqual(["a:1"]);

		writer.release();
		await writer.done;
		const later = await u.readUntil(1, during.cursor);
		expect(later.records.map((r) => `${r.id}:${r.version}`)).toEqual(["a:2"]);
	}, 60_000);
});

describe("cursors the store cannot honor", () => {
	it("answers garbage with a bad cursor and a wrong shape the same way", async () => {
		const u = await newUser();
		await expect(u.read("not-a-cursor")).rejects.toBeInstanceOf(
			InvalidCursorError,
		);
		await expect(
			u.read(encodeCursor({ e: "x", t: "abc", s: "1" })),
		).rejects.toBeInstanceOf(InvalidCursorError);
	});

	it("asks for a reset on another epoch", async () => {
		const u = await newUser();
		await u.apply([u.put("a", 0)]);
		const page = await u.readUntil(1);
		const real = JSON.parse(
			Buffer.from(page.cursor, "base64url").toString("utf8"),
		) as { e: string; t: string; s: string };
		// The real cursor is accepted; the same position under another epoch is not.
		await expect(u.read(page.cursor)).resolves.toMatchObject({ records: [] });
		await expect(
			u.read(encodeCursor({ ...real, e: `${real.e}-restored` })),
		).rejects.toBeInstanceOf(SyncResetRequiredError);
	});

	it("asks for a reset on a txid this cluster has not reached", async () => {
		const u = await newUser();
		const page = await u.read();
		const real = JSON.parse(
			Buffer.from(page.cursor, "base64url").toString("utf8"),
		) as { e: string; t: string; s: string };
		await expect(
			u.read(encodeCursor({ ...real, t: (2n ** 62n).toString() })),
		).rejects.toBeInstanceOf(SyncResetRequiredError);
	});

	it("accepts the cursor a caught-up page hands back, and a user with nothing gets one", async () => {
		const u = await newUser();
		const empty = await u.read();
		expect(empty).toMatchObject({ records: [], hasMore: false });
		await expect(u.read(empty.cursor)).resolves.toMatchObject({ records: [] });
	});

	it("refuses a limit outside 1 to 1000", async () => {
		const u = await newUser();
		for (const limit of [0, -1, 1001, 1.5]) {
			await expect(u.read(undefined, limit)).rejects.toMatchObject({
				code: "invalid_input",
			});
		}
		await expect(u.read(undefined, 1000)).resolves.toBeDefined();
	});
});

describe("isolation", () => {
	it("B sees none of A's records, even with A's cursor, and reuses A's ids as its own", async () => {
		const a = await newUser();
		const b = await newUser();
		await a.apply([a.put("shared-id", 0)]);
		const seen = await a.readUntil(1);
		expect(await b.read()).toMatchObject({ records: [] });
		expect((await b.read(seen.cursor)).records).toEqual([]);

		// B's create of the same id is B's own record; A's is untouched.
		await b.apply([b.put("shared-id", 0)]);
		expect(
			await outcome(b.apply([b.put("shared-id", 0, { record: { n: 9 } })])),
		).toEqual({
			code: "conflict",
			ids: ["shared-id"],
		});
		expect((await vaultRowsOf(a.id)).map((r) => r.version)).toEqual([1]);
		// A's write cannot reach B's record: base 1 on A's own id.
		await a.apply([a.put("shared-id", 1)]);
		expect((await vaultRowsOf(b.id)).map((r) => r.version)).toEqual([1]);
	}, 60_000);
});

describe("byte caps", () => {
	it("refuses a batch over 8 MiB of ciphertext and stores none of it", async () => {
		const u = await newUser();
		const big = (id: string) =>
			u.put(id, 0, { record: { pad: "x".repeat(1_040_000) } });
		const nine = Array.from({ length: 9 }, (_, i) => big(`b${i}`));
		expect(
			nine.reduce((n, w) => n + (w.ciphertext?.length ?? 0), 0),
		).toBeGreaterThan(8 * 1024 * 1024);
		expect(await outcome(u.apply(nine))).toEqual({
			code: "invalid_input",
			ids: [],
		});
		expect(await vaultRowsOf(u.id)).toEqual([]);
		// Seven of them (about 7.3 MB) are inside the cap.
		await u.apply(nine.slice(0, 7));
		expect((await vaultRowsOf(u.id)).length).toBe(7);
	}, 60_000);

	it("a page stops once the bytes before a row reach the cap, always keeps one row, and says more remain", async () => {
		// Each record is 122 bytes: the bytes before rows a to d are 0, 122, 244
		// and 366, so a cap of 200 takes a and b (the row that crosses it is in).
		const small = await newUser();
		await small.apply(["a", "b", "c", "d"].map((id) => small.put(id, 0)));
		await small.readUntil(4);
		const page = await small.read(undefined, 1000, 200);
		expect(ids(page.records)).toEqual(["a", "b"]);
		expect(page.hasMore).toBe(true);
		const rest = await small.read(page.cursor, 1000, 200);
		expect(ids(rest.records)).toEqual(["c", "d"]);
		expect(rest.hasMore).toBe(false);
		// The first row always comes, however small the cap.
		const one = await small.read(undefined, 1000, 1);
		expect(ids(one.records)).toEqual(["a"]);
		expect(one.hasMore).toBe(true);
	}, 60_000);

	it("the default page cap is 4 MiB: seven records of about 1.04 MB come as 5 and 2", async () => {
		const u = await newUser();
		const big = (id: string) =>
			u.put(id, 0, { record: { pad: "x".repeat(1_040_000) } });
		await u.apply(["a", "b", "c", "d", "e"].map(big));
		await u.apply(["f", "g"].map(big));
		await u.readUntil(7);
		// The bytes before rows a to e are 0, 1.04, 2.08, 3.12 and 4.16 MB, all
		// under 4 MiB (4.19 MB); before f it is 5.2 MB.
		const first = await u.read();
		expect(ids(first.records)).toEqual(["a", "b", "c", "d", "e"]);
		expect(first.hasMore).toBe(true);
		const rest = await u.readUntil(2, first.cursor);
		expect(ids(rest.records)).toEqual(["f", "g"]);
		expect(rest.hasMore).toBe(false);
	}, 60_000);
});
