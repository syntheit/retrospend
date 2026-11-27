import type { RetrospendClient } from "@retrospend/api-client";
import {
	createFakeSealer,
	EXPENSES_COLLECTION,
	EXPENSES_ENTITY,
	FakeVault,
	fakeVaultTransport,
	openFake,
	type VaultRecord,
} from "@retrospend/engine/device-fake-vault";
import { apiTransport, type Transport } from "@/features/entry/send";

// Two servers for the queue's contract suite (sync.contract.test.ts): API v1
// as the plain sender meets it, and the sealed vault. Both keep one expense
// per id with a counter version, and both are driven by the same faults and
// the same questions, so a test never says which one is under it.

export const problem = (status: number, code: string) =>
	Object.assign(new Error(code), { status, code });

/** What goes wrong between the phone and a server, the same for both. */
export class Faults {
	/** No network: nothing reaches the server. */
	down = false;
	/** Requests wait here before they land. */
	gate?: Promise<void>;
	/** Wait this long before landing (so concurrent sends overlap). */
	delay = 0;
	/** The server refuses this many requests, nothing stored. */
	refuse?: { status: number; code: string; times: number };
	/** The server stores this many requests and the answer is lost. */
	lose = 0;
	inFlight = 0;
	/** The most requests ever in flight at once. */
	most = 0;
	/** A queue that loops sends without end is stopped here, and the suite fails on `capped`. */
	static readonly CAP = 200;
	private sent = 0;
	capped = false;

	async around<T>(run: () => T): Promise<T> {
		this.sent += 1;
		if (this.sent > Faults.CAP) {
			this.capped = true;
			throw new Error(`more than ${Faults.CAP} requests: the queue is looping`);
		}
		this.inFlight += 1;
		this.most = Math.max(this.most, this.inFlight);
		try {
			if (this.down) throw new TypeError("Network request failed");
			if (this.gate) await this.gate;
			if (this.delay)
				await new Promise((resolve) => setTimeout(resolve, this.delay));
			if (this.refuse && this.refuse.times > 0) {
				this.refuse.times -= 1;
				throw problem(this.refuse.status, this.refuse.code);
			}
			const out = run();
			if (this.lose > 0) {
				this.lose -= 1;
				throw new TypeError("Network request failed");
			}
			return out;
		} finally {
			this.inFlight -= 1;
		}
	}
}

/**
 * The device's pulls: a pull that began after `since` and finished shows which
 * rows the server held then (`DeviceEngine.absentSince` reads the store the
 * same way). `rows` lists the live ids when a pull finishes.
 */
class Pulls {
	begun = 7;
	private finished = 0;
	private present = new Set<string>();
	constructor(private readonly rows: () => Iterable<string>) {}
	pull() {
		this.begun += 1;
		this.present = new Set(this.rows());
		this.finished = this.begun;
	}
	absentSince(id: string, since: number) {
		return this.finished > since && !this.present.has(id);
	}
}

export interface Harness {
	name: "plain" | "vault";
	/** Only what the queue passes along: the device engine and the sender never read it. */
	api: RetrospendClient;
	/** Where the phone's writes go; `rebuildTransport` swaps in a new instance (an app restart). */
	readonly transport: Transport;
	rebuildTransport(): void;
	faults: Faults;
	/** The device pulls: its copy of every row now matches the server's. */
	pull(): void;
	pullsBegun(): number;
	absentSince(id: string, since: number): boolean;
	/** How often anything was sealed; the vault only. */
	seals?(): number;
	/** Version `n` of a row as this server writes it (`updatedAt` text, or the vault's integer). */
	stamp(n: number): string;
	/** The live row as a pull would bring it: null when it was never made or is gone. */
	rowOf(id: string): {
		version: string;
		n: number;
		body: Record<string, unknown>;
	} | null;
	/** Each request that reached the server: its key, the row, the version it was checked against, and its bytes. */
	requests(): {
		key: string;
		id: string;
		base: number | null;
		sent: string;
	}[];
	elsewhere: {
		edit(id: string, patch: Record<string, unknown>): void;
		remove(id: string): void;
	};
	/** The server already holds another request under `key`. */
	hold(key: string): void;
}

interface PlainRow {
	n: number;
	body: Record<string, unknown>;
	gone: boolean;
}

export function plainHarness(): Harness {
	const faults = new Faults();
	const rows = new Map<string, PlainRow>();
	const answers = new Map<string, { request: string; answer: unknown }>();
	const undos = new Map<string, () => void>();
	const seen: ReturnType<Harness["requests"]> = [];
	const stamp = (n: number) =>
		`2026-10-05T03:00:${String(n).padStart(2, "0")}.000Z`;
	const unstamp = (text: string) => Number(text.slice(17, 19));

	// The Idempotency-Key rule (src/server/api/v1/idempotency.ts): the same
	// request replays its answer, another is refused, a failed one keeps nothing.
	const keyed = (key: string, input: unknown, run: () => unknown) => {
		const request = JSON.stringify(input);
		const kept = answers.get(key);
		if (kept) {
			if (kept.request !== request)
				throw problem(422, "idempotency_key_reused");
			return kept.answer;
		}
		const answer = run();
		answers.set(key, { request, answer });
		return answer;
	};
	const live = (id: string, expected: string) => {
		const row = rows.get(id);
		if (!row || row.gone) throw problem(404, "not_found");
		if (expected !== stamp(row.n)) throw problem(409, "expense_changed");
		return row;
	};
	type Options = { context?: { idempotencyKey?: string } };
	const keyOf = (options?: Options) => options?.context?.idempotencyKey ?? "";

	const create = (body: Record<string, unknown>, options?: Options) =>
		faults.around(() => {
			const key = keyOf(options);
			const id = String(body.id);
			seen.push({ key, id, base: null, sent: JSON.stringify(body) });
			return keyed(key, body, () => {
				if (rows.has(id)) throw problem(409, "id_taken");
				rows.set(id, { n: 1, body, gone: false });
				undos.set(`undo:${key}`, () => {
					const row = rows.get(id);
					if (row) {
						row.gone = true;
						row.n += 1;
					}
				});
				return { undo: `undo:${key}`, expense: { updatedAt: stamp(1) } };
			});
		});

	// Replaces the row and remembers how to put it back.
	const change = (
		key: string,
		id: string,
		row: PlainRow,
		next: Partial<PlainRow>,
	) => {
		const prior = { ...row };
		Object.assign(row, next, { n: row.n + 1 });
		undos.set(`undo:${key}`, () => {
			Object.assign(row, prior, { n: row.n + 1 });
		});
		return { undo: `undo:${key}`, id };
	};

	const update = (
		input: Record<string, unknown> & { expectedUpdatedAt: string },
		options?: Options,
	) =>
		faults.around(() => {
			const key = keyOf(options);
			const id = String(input.id);
			seen.push({
				key,
				id,
				base: unstamp(input.expectedUpdatedAt),
				sent: JSON.stringify(input),
			});
			return keyed(key, input, () => {
				const row = live(id, input.expectedUpdatedAt);
				const { expectedUpdatedAt: _stamp, ...body } = input;
				const done = change(key, id, row, { body });
				return { undo: done.undo, expense: { updatedAt: stamp(row.n) } };
			});
		});

	const remove = (
		input: { params: { id: string }; query: { expectedUpdatedAt: string } },
		options?: Options,
	) =>
		faults.around(() => {
			const key = keyOf(options);
			const { id } = input.params;
			seen.push({
				key,
				id,
				base: unstamp(input.query.expectedUpdatedAt),
				sent: JSON.stringify(input),
			});
			return keyed(key, input, () =>
				change(key, id, live(id, input.query.expectedUpdatedAt), {
					gone: true,
				}),
			);
		});

	const undo = (input: { token: string }, options?: Options) =>
		faults.around(() => {
			seen.push({
				key: keyOf(options),
				id: input.token,
				base: null,
				sent: input.token,
			});
			undos.get(input.token)?.();
			return {};
		});

	const api = {
		expenses: { create, update, delete: remove, undo },
		"shared-expenses": { create, undo },
	} as unknown as RetrospendClient;
	const pulls = new Pulls(() =>
		[...rows].filter(([, row]) => !row.gone).map(([id]) => id),
	);
	const transport = apiTransport(api);

	return {
		name: "plain",
		api,
		transport,
		rebuildTransport: () => {},
		faults,
		pull: () => pulls.pull(),
		pullsBegun: () => pulls.begun,
		absentSince: (id, since) => pulls.absentSince(id, since),
		stamp,
		rowOf: (id) => {
			const row = rows.get(id);
			return row && !row.gone
				? { version: stamp(row.n), n: row.n, body: row.body }
				: null;
		},
		requests: () => [...seen],
		elsewhere: {
			edit(id, patch) {
				const row = rows.get(id);
				if (row) {
					row.n += 1;
					row.body = { ...row.body, ...patch };
				}
			},
			remove(id) {
				const row = rows.get(id);
				if (row) {
					row.gone = true;
					row.n += 1;
				}
			},
		},
		hold: (key) => {
			answers.set(key, { request: "another request", answer: {} });
		},
	};
}

export function vaultHarness(): Harness {
	const faults = new Faults();
	const vault = new FakeVault();
	const sealer = createFakeSealer();
	const seen: ReturnType<Harness["requests"]> = [];
	// What this device holds: the records of its last pull.
	let pulledCopy = new Map<string, VaultRecord>();
	const pulls = new Pulls(() =>
		pulledCopy.size
			? [...pulledCopy.values()]
					.filter((r) => r.deletedAt === null)
					.map((r) => r.id)
			: [],
	);
	// The network sits between the sender and the store; another device and a
	// held key write to the store directly.
	const build = () =>
		fakeVaultTransport(
			{
				write: (key, writes) =>
					faults.around(() => {
						seen.push({
							key,
							id: writes[0]?.id ?? "",
							base: writes[0]?.baseVersion || null,
							sent: writes[0]?.ciphertext ?? "tombstone",
						});
						return vault.write(key, writes);
					}),
			},
			{ sealer, pulled: (id) => pulledCopy.get(id) },
		);
	let sender = build();
	let others = 0;
	const rowOf: Harness["rowOf"] = (id) => {
		const row = vault.read(id);
		if (!row || row.deletedAt !== null || row.ciphertext === null) return null;
		const { payload } = openFake(row.ciphertext).plain as {
			payload: Record<string, unknown>;
		};
		return { version: String(row.version), n: row.version, body: payload };
	};
	const write = (
		id: string,
		baseVersion: number,
		plain: unknown | null,
		key = `other-${++others}`,
	) =>
		vault.write(key, [
			{
				id,
				collectionId: EXPENSES_COLLECTION,
				entity: EXPENSES_ENTITY,
				baseVersion,
				ciphertext: plain === null ? null : sealer.seal(plain, baseVersion + 1),
			},
		]);

	return {
		name: "vault",
		// The vault path never reads the API client.
		api: {} as RetrospendClient,
		get transport(): Transport {
			return {
				...sender,
				// The fake vault writes expenses only; a recurring entry is refused
				// until the sealed recurring sender exists.
				dispatch: (entry, call) => {
					if (entry.kind === "confirm" || entry.kind === "skip")
						throw new Error("The fake vault has no recurring writes");
					return sender.dispatch(entry, call);
				},
			};
		},
		rebuildTransport: () => {
			sender = build();
		},
		faults,
		pull: () => {
			pulledCopy = new Map(vault.all().map((r) => [r.id, r]));
			pulls.pull();
		},
		pullsBegun: () => pulls.begun,
		absentSince: (id, since) => pulls.absentSince(id, since),
		seals: () => sealer.count,
		stamp: String,
		rowOf,
		requests: () => [...seen],
		elsewhere: {
			edit(id, patch) {
				const row = rowOf(id);
				if (row)
					write(id, row.n, {
						id,
						payload: { ...row.body, ...patch },
						rows: [],
					});
			},
			remove(id) {
				const row = rowOf(id);
				if (row) write(id, row.n, null);
			},
		},
		hold: (key) => {
			write("someone-elses-row", 0, { id: "someone-elses-row" }, key);
		},
	};
}
