// A vault double for the transport contract (not shipped: only tests import it,
// through the "./device-fake-vault" export). It models the rules of the real
// store, each cited, and nothing the real store lacks:
//   src/server/services/vault/vault.service.ts   writes, versions, conflicts
//   src/server/services/vault/validate.ts        batch shape
//   src/server/api/v1/idempotency.ts             a key keeps an exact request
// The wire shape is packages/api-contract/src/vault/index.ts.

export interface VaultWrite {
	id: string;
	collectionId: string;
	entity: number;
	/** The version the writer read; 0 creates. The write becomes `baseVersion + 1`. */
	baseVersion: number;
	/** Sealed bytes as text, or null for a tombstone. */
	ciphertext: string | null;
}

export interface VaultRecord {
	id: string;
	collectionId: string;
	entity: number;
	version: number;
	ciphertext: string | null;
	/** Set for a tombstone (vault.service.ts:67-69). */
	deletedAt: string | null;
}

/** A refusal as the client sees it: `status` and `code` are what `classify` reads. */
export class VaultProblem extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		/** The ids of the records that conflicted (serve.ts:84-87); ids only. */
		readonly conflictIds: readonly string[] = [],
	) {
		super(code);
		this.name = "VaultProblem";
	}
}

interface Kept {
	/** The exact request: the real store keeps a keyed fingerprint of it (idempotency.service.ts:118-127). */
	request: string;
	results: { id: string; version: number }[];
}

export class FakeVault {
	private readonly records = new Map<string, VaultRecord>();
	private readonly keys = new Map<string, Kept>();
	/** Each request that reached the vault, in order: its key and the bytes it carried. */
	readonly requests: { key: string; writes: readonly VaultWrite[] }[] = [];

	read(id: string): VaultRecord | undefined {
		const row = this.records.get(id);
		return row && { ...row };
	}

	/**
	 * One POST /vault/writes under an Idempotency-Key. The same request under a
	 * key answers what the first one did (idempotency.ts:68-77); another request
	 * under it is refused (idempotency.ts:64-66, :178). A request that failed
	 * keeps no key (idempotency.ts:78-84), so a corrected batch may reuse it.
	 */
	write(key: string, writes: readonly VaultWrite[]) {
		this.requests.push({ key, writes });
		const request = JSON.stringify(writes);
		const kept = this.keys.get(key);
		if (kept) {
			if (kept.request !== request)
				throw new VaultProblem(422, "idempotency_key_reused");
			return { results: kept.results };
		}
		const results = this.apply(writes);
		this.keys.set(key, { request, results });
		return { results };
	}

	/** All or nothing (vault.service.ts:121-139): every conflict is gathered, then none is stored. */
	private apply(writes: readonly VaultWrite[]) {
		this.validate(writes);
		const staged = new Map(this.records);
		const conflicts: string[] = [];
		// Id order, so the conflict list has one order (vault.service.ts:128).
		for (const w of [...writes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
			const row = staged.get(w.id);
			if (
				row &&
				(row.collectionId !== w.collectionId || row.entity !== w.entity)
			)
				// A record never moves (vault.service.ts:98-101).
				throw new VaultProblem(400, "bad_request");
			const fresh = w.baseVersion === 0 && !row;
			const next = !fresh && row && row.version === w.baseVersion;
			if (fresh || next) {
				// A live write over a tombstone revives it (vault.service.ts:66-69).
				staged.set(w.id, {
					id: w.id,
					collectionId: w.collectionId,
					entity: w.entity,
					version: w.baseVersion + 1,
					ciphertext: w.ciphertext,
					deletedAt: w.ciphertext === null ? "tombstoned" : null,
				});
				continue;
			}
			// Already stored exactly: same version, same bytes, so a retry answers (vault.service.ts:103).
			const replay =
				row &&
				row.version === w.baseVersion + 1 &&
				row.ciphertext === w.ciphertext;
			if (!replay) conflicts.push(w.id);
		}
		if (conflicts.length > 0)
			throw new VaultProblem(409, "conflict", conflicts);
		for (const [id, row] of staged) this.records.set(id, row);
		return writes.map((w) => ({ id: w.id, version: w.baseVersion + 1 }));
	}

	/** validate.ts:75-100: a tombstone needs a record to end, and one id is written once per batch. */
	private validate(writes: readonly VaultWrite[]) {
		const seen = new Set<string>();
		for (const w of writes) {
			if (w.ciphertext === null && w.baseVersion === 0)
				throw new VaultProblem(400, "bad_request");
			if (seen.has(w.id)) throw new VaultProblem(400, "bad_request");
			seen.add(w.id);
		}
	}
}

const hex = (text: string) =>
	[...new TextEncoder().encode(text)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
const unhex = (text: string) =>
	new TextDecoder().decode(
		Uint8Array.from(text.match(/../g) ?? [], (h) => Number.parseInt(h, 16)),
	);

/**
 * A sealer whose every call differs, as the real one does (a fresh random
 * nonce): sealing the same record twice gives two byte strings. The version is
 * inside, as the real format binds it in the AAD.
 */
export function createFakeSealer() {
	let nonce = 0;
	return {
		/** How many times anything was sealed. */
		get count() {
			return nonce;
		},
		seal(plain: unknown, version: number): string {
			nonce += 1;
			return hex(`${nonce}|${version}|${JSON.stringify(plain)}`);
		},
	};
}

export function openFake(ciphertext: string): {
	version: number;
	plain: unknown;
} {
	const [, version, ...rest] = unhex(ciphertext).split("|");
	return { version: Number(version), plain: JSON.parse(rest.join("|")) };
}

/** What the sender needs of the store: a test may put a network in front of `write`. */
export interface VaultPort {
	write(key: string, writes: readonly VaultWrite[]): unknown;
	read(id: string): VaultRecord | undefined;
}

/** The part of an outbox entry a vault write is made from. */
export interface VaultEntry {
	clientId: string;
	kind: "create" | "update" | "delete";
	targetId: string;
	baseVersion: string | null | { after: string };
	payload: unknown;
	device?: { changes: readonly { after: unknown }[] };
}

/** Where expense records live in the vault (the clients' registry number, never interpreted by the store). */
export const EXPENSES_COLLECTION = "expenses";
export const EXPENSES_ENTITY = 1;

interface Prepared {
	/** What the write carries: sealed once, never again. Null is a tombstone. */
	ciphertext: string | null;
	/** What the record held before, for Undo. */
	prior: unknown;
}

/**
 * The sender side of the vault (K9): an outbox entry becomes one write,
 * sealed once. A create is base 0, an edit the version the entry was based on,
 * a delete a tombstone. A version is the vault's integer, carried as its
 * decimal text. Structurally a `Transport` of the phone's sender, so the same
 * queue runs over it.
 */
export function fakeVaultTransport(
	vault: VaultPort,
	sealer = createFakeSealer(),
) {
	// Fixed at the first send of a key: a retry resends these bytes under the
	// same key, and a second seal would be another request (a reused key).
	const prepared = new Map<string, Prepared>();
	const sealedFor = new Map<string, number>();
	const history = new Map<
		string,
		{ id: string; next: number; prior: unknown }
	>();

	const prepare = (key: string, make: () => Prepared): Prepared => {
		let ready = prepared.get(key);
		if (!ready) {
			ready = make();
			prepared.set(key, ready);
		}
		return ready;
	};
	const seal = (key: string, plain: unknown, version: number) => {
		sealedFor.set(key, (sealedFor.get(key) ?? 0) + 1);
		return sealer.seal(plain, version);
	};

	// A conflict on a record that is gone is the plain path's 404; on a live
	// one it is a newer version. The sender reads the record to tell them apart.
	const refusal = (error: unknown, entry: VaultEntry) => {
		if (!(error instanceof VaultProblem) || error.code !== "conflict")
			return error;
		if (entry.kind === "create") return error;
		const row = vault.read(entry.targetId);
		return row && row.deletedAt === null
			? new VaultProblem(409, "expense_changed", error.conflictIds)
			: new VaultProblem(404, "not_found");
	};

	return {
		/** How often a key's write was sealed: 1 however often it was sent. */
		sealedTimes: (key: string) => sealedFor.get(key) ?? 0,
		async dispatch(
			entry: VaultEntry,
			options: { context: { idempotencyKey: string } },
		) {
			const key = options.context.idempotencyKey;
			// A stamp that is not a version is never a base: 0 would create.
			const base =
				entry.kind === "create"
					? 0
					: typeof entry.baseVersion === "string"
						? Number(entry.baseVersion)
						: Number.NaN;
			if (!Number.isInteger(base)) throw new VaultProblem(400, "bad_request");
			const ready = prepare(key, () => {
				const row = vault.read(entry.targetId);
				return {
					ciphertext:
						entry.kind === "delete"
							? null
							: seal(
									key,
									{
										id: entry.targetId,
										payload: entry.payload,
										rows: entry.device?.changes.map((c) => c.after) ?? [],
									},
									base + 1,
								),
					prior: row?.ciphertext ? openFake(row.ciphertext).plain : null,
				};
			});
			try {
				await vault.write(key, [
					{
						id: entry.targetId,
						collectionId: EXPENSES_COLLECTION,
						entity: EXPENSES_ENTITY,
						baseVersion: base,
						ciphertext: ready.ciphertext,
					},
				]);
			} catch (error) {
				throw refusal(error, entry);
			}
			history.set(entry.clientId, {
				id: entry.targetId,
				next: base + 1,
				prior: ready.prior,
			});
			return {
				// The token is the entry's own id: Undo is one more write, not a server route.
				undo: entry.clientId,
				version: entry.kind === "delete" ? null : String(base + 1),
			};
		},
		/** Takes a write back as the next version of its record, sealed once under the undo's key. */
		async undo(ref: { token: string }, key: string) {
			const done = history.get(ref.token);
			if (!done) throw new VaultProblem(404, "not_found");
			const { ciphertext } = prepare(key, () => ({
				ciphertext:
					done.prior === null ? null : seal(key, done.prior, done.next + 1),
				prior: null,
			}));
			await vault.write(key, [
				{
					id: done.id,
					collectionId: EXPENSES_COLLECTION,
					entity: EXPENSES_ENTITY,
					baseVersion: done.next,
					ciphertext,
				},
			]);
		},
	};
}
