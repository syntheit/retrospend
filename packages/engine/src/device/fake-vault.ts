// A vault double for the transport contract (not shipped: only tests import it,
// through the "./device-fake-vault" export). The store models the rules of the
// real one, each cited. The sender below uses only what a client has: its
// outbox entry, POST /vault/writes (`VaultPort.write`) and the records it
// pulled through GET /vault/changes (`pulled`). `FakeVault.read` is for a
// test's own assertions, never the sender's:
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

	/** For a test's own assertions and its pull: the sender never reads the store. */
	read(id: string): VaultRecord | undefined {
		const row = this.records.get(id);
		return row && { ...row };
	}

	all(): VaultRecord[] {
		return [...this.records.values()].map((row) => ({ ...row }));
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

// UTF-16 code units as four hex digits each: the engine's lib has no TextEncoder.
const hex = (text: string) =>
	Array.from(text, (c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join(
		"",
	);
const unhex = (text: string) =>
	(text.match(/.{4}/g) ?? [])
		.map((h) => String.fromCharCode(Number.parseInt(h, 16)))
		.join("");

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

/** The one call the sender makes on the store (POST /vault/writes); a test may put a network in front of it. */
export interface VaultPort {
	write(key: string, writes: readonly VaultWrite[]): unknown;
}

/** The part of an outbox entry a vault write is made from. */
export interface VaultEntry {
	clientId: string;
	kind: "create" | "update" | "delete";
	targetId: string;
	baseVersion: string | null | { after: string };
	payload: unknown;
	device?: { changes: readonly { after: unknown }[] };
	/** Sends begun, this one included: 1 is the first. */
	attempts: number;
}

/** What a vault transport is given with each request (the phone's `CallOptions`, as far as it reads it). */
export interface VaultCall {
	context: { idempotencyKey: string };
	/** The entry's sealed request: read first, written (awaited) before the request leaves. */
	sealed: { bytes: string | undefined; keep(bytes: string): Promise<void> };
}

/** Where expense records live in the vault (the clients' registry number, never interpreted by the store). */
export const EXPENSES_COLLECTION = "expenses";
export const EXPENSES_ENTITY = 1;

/** What the record held before a write, when this client cannot know it any more. */
const UNKNOWN = Symbol("unknown prior");

/**
 * The sender side of the vault (K9): an outbox entry becomes one write,
 * sealed once. A create is base 0, an edit the version the entry was based on,
 * a delete a tombstone. A version is the vault's integer, carried as its
 * decimal text. Structurally a `Transport` of the phone's sender, so the same
 * queue runs over it. The sealed bytes live in the entry (`call.sealed`), so
 * a retry after a restart, or by another instance of this sender, resends the
 * same bytes: a second seal would be another request (a reused key).
 * `pulled` is the record as this client last pulled it; Undo restores it.
 */
export function fakeVaultTransport(
	vault: VaultPort,
	options: {
		sealer?: ReturnType<typeof createFakeSealer>;
		pulled?: (id: string) => VaultRecord | undefined;
	} = {},
) {
	const sealer = options.sealer ?? createFakeSealer();
	const pulled = options.pulled ?? (() => undefined);
	// Taken at the first send, while it is still what the write replaced.
	const priors = new Map<string, unknown>();
	const history = new Map<
		string,
		{ id: string; next: number; prior: unknown }
	>();

	// A conflict does not say whether the record changed or is gone, and the
	// client may not look at the store to find out: it parks, and a later pull
	// shows a tombstone or nothing (the queue resolves it like a 404).
	const refusal = (error: unknown, entry: VaultEntry) =>
		error instanceof VaultProblem &&
		error.code === "conflict" &&
		entry.kind !== "create"
			? new VaultProblem(409, "expense_changed", error.conflictIds)
			: error;

	return {
		async dispatch(entry: VaultEntry, call: VaultCall) {
			const key = call.context.idempotencyKey;
			// A stamp that is not a version is never a base: 0 would create.
			const base =
				entry.kind === "create"
					? 0
					: typeof entry.baseVersion === "string"
						? Number(entry.baseVersion)
						: Number.NaN;
			if (!Number.isInteger(base)) throw new VaultProblem(400, "bad_request");
			if (entry.attempts <= 1) {
				const row = pulled(entry.targetId);
				priors.set(
					key,
					row?.ciphertext ? openFake(row.ciphertext).plain : null,
				);
			}
			let ciphertext: string | null = null;
			if (entry.kind !== "delete") {
				ciphertext =
					call.sealed.bytes ??
					sealer.seal(
						{
							id: entry.targetId,
							payload: entry.payload,
							rows: entry.device?.changes.map((c) => c.after) ?? [],
						},
						base + 1,
					);
				if (call.sealed.bytes === undefined) await call.sealed.keep(ciphertext);
			}
			try {
				await vault.write(key, [
					{
						id: entry.targetId,
						collectionId: EXPENSES_COLLECTION,
						entity: EXPENSES_ENTITY,
						baseVersion: base,
						ciphertext,
					},
				]);
			} catch (error) {
				throw refusal(error, entry);
			}
			history.set(entry.clientId, {
				id: entry.targetId,
				next: base + 1,
				prior:
					entry.kind === "create"
						? null
						: priors.has(key)
							? priors.get(key)
							: UNKNOWN,
			});
			return {
				// The token is the entry's own id: Undo is one more write, not a server route.
				undo: entry.clientId,
				version: entry.kind === "delete" ? null : String(base + 1),
			};
		},
		/**
		 * Takes a write back as the next version of its record, under the undo's
		 * key (a new one per attempt, so nothing is resent). Refused when the
		 * record before is not known: it is never guessed.
		 */
		async undo(ref: { token: string }, key: string) {
			const done = history.get(ref.token);
			if (!done || done.prior === UNKNOWN)
				throw new VaultProblem(404, "not_found");
			await vault.write(key, [
				{
					id: done.id,
					collectionId: EXPENSES_COLLECTION,
					entity: EXPENSES_ENTITY,
					baseVersion: done.next,
					ciphertext:
						done.prior === null ? null : sealer.seal(done.prior, done.next + 1),
				},
			]);
		},
	};
}
