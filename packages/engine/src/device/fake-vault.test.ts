import { describe, expect, it } from "vitest";
import {
	createFakeSealer,
	FakeVault,
	fakeVaultTransport,
	openFake,
	type VaultEntry,
	VaultProblem,
	type VaultWrite,
} from "./fake-vault";

// The double's own rules, each one the real store's (cited in fake-vault.ts).
// Values: USD 100 booked at blue 1,545 is ARS 154,500.00; edited to USD 120 it
// is ARS 185,400.00.

const w = (
	id: string,
	baseVersion: number,
	ciphertext: string | null = `bytes-${id}-${baseVersion}`,
	over: Partial<VaultWrite> = {},
): VaultWrite => ({
	id,
	collectionId: "expenses",
	entity: 1,
	baseVersion,
	ciphertext,
	...over,
});

const refused = (run: () => unknown): VaultProblem => {
	try {
		run();
	} catch (error) {
		if (error instanceof VaultProblem) return error;
	}
	throw new Error("not refused");
};

describe("versions", () => {
	it("a create is base 0 and becomes version 1; an edit becomes base + 1", () => {
		const vault = new FakeVault();
		expect(vault.write("k1", [w("a", 0)]).results).toEqual([
			{ id: "a", version: 1 },
		]);
		expect(vault.write("k2", [w("a", 1)]).results).toEqual([
			{ id: "a", version: 2 },
		]);
		expect(vault.read("a")?.version).toBe(2);
	});

	it("a stale base or a taken id is a conflict and stores nothing", () => {
		const vault = new FakeVault();
		vault.write("k1", [w("a", 0)]);
		vault.write("k2", [w("a", 1)]);
		const stale = refused(() => vault.write("k3", [w("a", 1, "other")]));
		expect([stale.status, stale.code, stale.conflictIds]).toEqual([
			409,
			"conflict",
			["a"],
		]);
		const taken = refused(() => vault.write("k4", [w("a", 0, "other")]));
		expect(taken.code).toBe("conflict");
		expect(vault.read("a")?.ciphertext).toBe("bytes-a-1");
	});

	it("lists every conflicting id in id order and keeps none of the batch", () => {
		const vault = new FakeVault();
		vault.write("k1", [w("b", 0), w("c", 0)]);
		const error = refused(() =>
			vault.write("k2", [w("c", 0, "x"), w("fresh", 0), w("b", 0, "y")]),
		);
		expect(error.conflictIds).toEqual(["b", "c"]);
		expect(vault.read("fresh")).toBeUndefined();
	});
});

describe("replay by exact bytes", () => {
	it("a write already stored exactly answers as applied, under any key", () => {
		const vault = new FakeVault();
		vault.write("k1", [w("a", 0)]);
		expect(vault.write("lost-answer-retry", [w("a", 0)]).results).toEqual([
			{ id: "a", version: 1 },
		]);
		expect(vault.read("a")?.version).toBe(1);
	});

	it("the same version with other bytes is a conflict", () => {
		const vault = new FakeVault();
		vault.write("k1", [w("a", 0)]);
		expect(refused(() => vault.write("k2", [w("a", 0, "resealed")])).code).toBe(
			"conflict",
		);
	});

	it("the same request under the same key answers the first answer without a second write", () => {
		const vault = new FakeVault();
		vault.write("k1", [w("a", 0)]);
		vault.write("k2", [w("a", 1)]);
		// k1 again: a stale base now, but the key answers what it did.
		expect(vault.write("k1", [w("a", 0)]).results).toEqual([
			{ id: "a", version: 1 },
		]);
		expect(vault.read("a")?.version).toBe(2);
	});

	it("other bytes under the same key are refused like a reused key", () => {
		const vault = new FakeVault();
		vault.write("k1", [w("a", 0)]);
		const error = refused(() => vault.write("k1", [w("a", 0, "resealed")]));
		expect([error.status, error.code]).toEqual([422, "idempotency_key_reused"]);
	});

	it("a refused request keeps no key, so a corrected batch may reuse it", () => {
		const vault = new FakeVault();
		vault.write("k1", [w("a", 0)]);
		refused(() => vault.write("k2", [w("a", 0, "other")]));
		expect(vault.write("k2", [w("a", 1)]).results).toEqual([
			{ id: "a", version: 2 },
		]);
	});
});

describe("shape and tombstones", () => {
	it("refuses a record that moves, a tombstone at base 0 and a repeated id", () => {
		const vault = new FakeVault();
		vault.write("k1", [w("a", 0)]);
		expect(
			refused(() => vault.write("k2", [w("a", 1, "x", { entity: 2 })])).code,
		).toBe("bad_request");
		expect(refused(() => vault.write("k3", [w("z", 0, null)])).status).toBe(
			400,
		);
		expect(
			refused(() => vault.write("k4", [w("y", 0), w("y", 0, "b")])).status,
		).toBe(400);
	});

	it("a tombstone is a version, and a live write over it revives the record", () => {
		const vault = new FakeVault();
		vault.write("k1", [w("a", 0)]);
		vault.write("k2", [w("a", 1, null)]);
		expect(vault.read("a")).toMatchObject({ version: 2, ciphertext: null });
		expect(vault.read("a")?.deletedAt).not.toBeNull();
		vault.write("k3", [w("a", 2)]);
		expect(vault.read("a")).toMatchObject({ version: 3, deletedAt: null });
	});
});

describe("the sealer", () => {
	it("sealing one record twice gives two byte strings, and each opens to the record and its version", () => {
		const sealer = createFakeSealer();
		const record = { amount: "100", homeAmount: "154500.00" };
		const [first, second] = [sealer.seal(record, 1), sealer.seal(record, 1)];
		expect(first).not.toBe(second);
		expect(openFake(first)).toEqual({ version: 1, plain: record });
		expect(openFake(second)).toEqual({ version: 1, plain: record });
	});
});

describe("the sender over it", () => {
	const entry = (over: Partial<VaultEntry> = {}): VaultEntry => ({
		clientId: "c1",
		kind: "update",
		targetId: "a",
		baseVersion: "1",
		payload: { id: "a", amount: "120", currency: "USD" },
		device: {
			changes: [{ after: { amount: "120.00", homeAmount: "185400.00" } }],
		},
		...over,
	});
	const key = (clientId: string) => ({ context: { idempotencyKey: clientId } });

	it("seals once per key: a retry resends identical bytes", async () => {
		const vault = new FakeVault();
		const sender = fakeVaultTransport(vault);
		await sender.dispatch(
			entry({ kind: "create", baseVersion: null }),
			key("c0"),
		);
		await sender.dispatch(entry(), key("c1"));
		// The answer was lost; the same entry goes again under the same key.
		await sender.dispatch(entry(), key("c1"));
		const sends = vault.requests.filter((r) => r.key === "c1");
		expect(sends).toHaveLength(2);
		expect(sends[1]?.writes).toEqual(sends[0]?.writes);
		expect(sender.sealedTimes("c1")).toBe(1);
		const sealed = vault.read("a")?.ciphertext;
		expect(openFake(sealed ?? "")).toMatchObject({
			version: 2,
			plain: { rows: [{ homeAmount: "185400.00" }] },
		});
	});

	it("a create is base 0, an edit its stamp, a delete a tombstone", async () => {
		const vault = new FakeVault();
		const sender = fakeVaultTransport(vault);
		const made = await sender.dispatch(
			entry({ kind: "create", baseVersion: null }),
			key("c0"),
		);
		const edited = await sender.dispatch(entry(), key("c1"));
		const deleted = await sender.dispatch(
			entry({ kind: "delete", baseVersion: "2" }),
			key("c2"),
		);
		expect([made.version, edited.version, deleted.version]).toEqual([
			"1",
			"2",
			null,
		]);
		expect(vault.read("a")).toMatchObject({ version: 3, ciphertext: null });
		expect(vault.requests.map((r) => r.writes[0]?.baseVersion)).toEqual([
			0, 1, 2,
		]);
	});

	it("never turns a missing stamp into a create", async () => {
		const sender = fakeVaultTransport(new FakeVault());
		const error = await sender
			.dispatch(entry({ baseVersion: null }), key("c1"))
			.catch((e: VaultProblem) => e);
		expect(error).toMatchObject({ status: 400 });
	});

	it("tells a newer version from a gone record, and leaves a create conflict as it is", async () => {
		const vault = new FakeVault();
		const sealer = createFakeSealer();
		const sender = fakeVaultTransport(vault, sealer);
		await sender.dispatch(
			entry({ kind: "create", baseVersion: null }),
			key("c0"),
		);
		// Another device's write, sealed as a device seals.
		vault.write("elsewhere", [
			w("a", 1, sealer.seal({ payload: "theirs" }, 2)),
		]);
		const newer = await sender.dispatch(entry(), key("c1")).catch((e) => e);
		expect(newer).toMatchObject({
			status: 409,
			code: "expense_changed",
			conflictIds: ["a"],
		});
		vault.write("gone", [w("a", 2, null)]);
		const gone = await sender
			.dispatch(entry({ baseVersion: "2", clientId: "c3" }), key("c3"))
			.catch((e) => e);
		expect(gone).toMatchObject({ status: 404, code: "not_found" });
		const taken = await sender
			.dispatch(
				entry({ kind: "create", baseVersion: null, clientId: "c4" }),
				key("c4"),
			)
			.catch((e) => e);
		expect(taken).toMatchObject({ status: 409, code: "conflict" });
	});

	it("undo writes the version before back, and a create's undo is a tombstone", async () => {
		const vault = new FakeVault();
		const sender = fakeVaultTransport(vault);
		const made = entry({
			kind: "create",
			baseVersion: null,
			payload: { amount: "100" },
		});
		const first = await sender.dispatch(made, key("c0"));
		const second = await sender.dispatch(entry(), key("c1"));
		await sender.undo({ token: second.undo }, "c1-undo-1");
		expect(vault.read("a")?.version).toBe(3);
		expect(openFake(vault.read("a")?.ciphertext ?? "").plain).toMatchObject({
			payload: { amount: "100" },
		});
		await sender
			.undo({ token: first.undo }, "c0-undo-1")
			.catch(() => undefined);
		// The create's undo is based on version 1, but the record moved on: refused.
		expect(vault.read("a")?.version).toBe(3);
	});
});
