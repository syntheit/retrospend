import { monthVerdictIncomplete } from "@retrospend/domain/envelope/verdict";
import { runtimeTimeZone } from "@retrospend/domain/time-zone";
import { deviceMonthView } from "../budget-figures";
import { budgetStatus } from "../budget-gate";
import { NotFoundError } from "../errors";
import { MemoryStore } from "../memory-store";
import {
	type Change,
	InvalidInputError,
	type Reader,
	SETTINGS_ID,
} from "../port";
import { ratesAsOf } from "../rates";
import { DEVICE_FIGURE_IDS, readDeviceFigures } from "../registry";
import { type PullCursors, type PullReport, pullAll } from "../sync-pull";
import { compareWrite, type WriteVerdict } from "../write-parity";
import { type BookedWrite, bookIn, targetOf, type WriteOp } from "./book";
import {
	answerVerdicts,
	type BulkAnswer,
	type BulkBooked,
	type BulkOp,
	type BulkSent,
	bookBulkIn,
	compareBulkRow,
	comparePreviewBulk as runBulkCompare,
} from "./bulk";
import {
	COMPARE_WHAT,
	type CompareReport,
	compareLine,
	type NarrowValues,
	type ScreenName,
	type VerdictView,
} from "./compare";
import {
	type CompareDeps,
	compareScreen,
	type PulledPast,
} from "./compare-run";
import { type PendingSource, readOverlaid, retiredBy } from "./pending";
import type { DeviceApi, EngineStorage, StorageHooks } from "./ports";
import {
	comparePreview as runPreviewCompare,
	type ServerPreview,
} from "./preview-compare";
import { type Rebase, rebaseOf } from "./rebase";

// The device engine: a copy of the account's rows in memory, filled by the
// pull driver through a DeviceApi, and the figures read from those rows. It
// runs on the phone and in the web worker, so it knows no network client, no
// disk and no console: the api, the clock, the log and the disk copy come in.
// The release builds drop it with the dev flag; scripts/check-release-bundle.sh
// (the phone) greps for TAG, which must not appear in a release bundle.
export const TAG = "RetrospendDeviceEngine";

export const PULL_AFTER_MS = 60_000;

const RESET_REQUIRED = "sync_reset_required";

export type DeviceStatus = "idle" | "pulling" | "ready" | "failed";

/** What the screens may ask of the device: a check of their figures against the server's. */
export interface DeviceReads {
	/**
	 * Holds the device's figures for `screen` against the server's and logs the
	 * result (ids and counts, `compareLine`); the screen keeps showing the
	 * server's numbers. `narrowings` are the values the screen renders (envelope,
	 * account, template and category ids, month labels). `serverVerdict` reads the
	 * verdict the screen showed again, through its own query. Never rejects;
	 * null when the check could not run (an account with Advanced protection,
	 * which the server never answers for, a disposed engine, or an error).
	 */
	compare(
		screen: ScreenName,
		narrowings?: NarrowValues,
		serverVerdict?: () => Promise<VerdictView | null>,
	): Promise<CompareReport | null>;
}

/** What the write parity check found, by counts and ids: never an amount, title or note. */
export interface WriteParity {
	/** Per outcome ("match", "differs", "rate_missing", "refused", "skipped:<code>", "expired"). */
	readonly counts: Readonly<Record<string, number>>;
	/** The latest verdicts, oldest first. */
	readonly recent: readonly WriteVerdict[];
}

/** The most verdicts `WriteParity.recent` keeps. */
const RECENT_WRITES = 100;

export interface DeviceEngine extends DeviceReads {
	/** "ready" at once when the disk copy holds a whole pull; "idle" until a pull otherwise. */
	readonly status: DeviceStatus;
	/** Pulls that have finished. */
	readonly generation: number;
	/**
	 * Pulls begun, finished or not. The number a pending entry's ack carries:
	 * a pull numbered above it began after the ack, so it has seen the write.
	 */
	readonly pullsBegun: number;
	/** The last compare that ran, for readouts and tests. */
	readonly lastCompare: CompareReport | null;
	/** Creates the server booked, compared with the device's own booking of them (dev only). */
	readonly writeParity: WriteParity;
	/** Stopped for good: a new engine is needed to read or pull again. */
	readonly disposed: boolean;
	/**
	 * Runs `read` over the store with the phone's pending writes laid over it, in
	 * a transaction that is thrown away. For the device preview, the write compare
	 * and the K9 swap gate; never a screen's read (`compare` and the figures a
	 * screen shows read the store as a pull left it). Null when the store is not
	 * a whole copy, a pull began during the read, the engine is disposed or the
	 * read failed. With no pending source it reads the store as it is.
	 */
	readWithPending<R>(read: (view: Reader) => R | Promise<R>): Promise<R | null>;
	/**
	 * Books what the phone is about to save, the way the server will: the engine
	 * mutation over the pending writes, in a transaction that is thrown away.
	 * The result is what the outbox entry keeps (`device`); nothing is stored
	 * or shown. Null when the device cannot book it (not ready, a pull began
	 * during it, or a refusal such as "Sync first"): the entry then carries no
	 * device booking and the server books it alone.
	 */
	book(op: WriteOp): Promise<BookedWrite | null>;
	/**
	 * The body that saves the expense again as the last pull left it, with no
	 * pending write laid over it, and the version it is checked against (Try
	 * again on a parked edit). Null when the row is not there, was booked on the
	 * device only, or cannot be saved from the phone; never guessed.
	 */
	storedRebase(id: string): Promise<Rebase | null>;
	/**
	 * True when a pull that began after pull number `pull` (a `pullsBegun`
	 * reading) has finished and the store has no such expense: another device
	 * deleted it, or a sync reset took it. A pull that began before `pull`
	 * resolves nothing. False when it cannot tell.
	 */
	absentSince(id: string, pull: number): Promise<boolean>;
	/**
	 * Holds the device's preview of `op` against the server's dry run of it
	 * (`pending_ahead` while an entry for the same row has not been shown back).
	 * Counted and logged by ids and figure names; the screen keeps the server's
	 * diff. Null when it could not run.
	 */
	comparePreview(
		op: WriteOp,
		server: ServerPreview,
	): Promise<WriteVerdict | null>;
	/**
	 * What the device books for a bulk categorize or delete, over the pending
	 * writes, in a transaction that is thrown away. Null when it cannot (not
	 * ready, a pull began during it, or a refusal such as "Sync first").
	 */
	bookBulk(op: BulkOp): Promise<BulkBooked | null>;
	/** `comparePreview` for a bulk action: `pending_ahead` while an entry touches a picked id. */
	comparePreviewBulk(
		op: BulkOp,
		server: ServerPreview,
	): Promise<WriteVerdict | null>;
	/**
	 * The server took a bulk action `key` names (its batch id). Holds the
	 * device's booking (null when it could not book) against the answer now,
	 * retires the rows both left alone, and holds the rest against the rows of
	 * the next pull.
	 */
	settleBulk(
		key: string,
		booked: BulkBooked | null,
		answer: BulkAnswer,
		ids: readonly string[],
	): void;
	/** The person undid bulk action `key`: its rows are not compared, and wait for a pull. */
	undoneBulk(key: string): void;
	/**
	 * The ids of every bulk action the server took that no pull has settled
	 * yet. The store still holds their old rows, so the phone does not run
	 * another bulk action over them ("Sync first").
	 */
	bulkUnsettled(): ReadonlySet<string>;
	/** One pull at a time: a call while one runs waits for it. */
	pull(): Promise<void>;
	/** Pulls when none has finished yet or the last one is older than PULL_AFTER_MS. */
	pullIfStale(): Promise<void>;
	/**
	 * Stops the engine: its disk copy takes no more writes and is closed, and
	 * with `wipe` its file and key are deleted. A pull that is still running
	 * fails at its next write, and nothing opens the file again.
	 */
	dispose(options: { wipe: boolean }): Promise<void>;
}

export interface DeviceEngineOptions {
	/** Opens the disk copy; absent or null means memory-only. */
	storage?: (hooks: StorageHooks) => Promise<EngineStorage | null>;
	/** Where the engine reports what went wrong: a short reason and ids and counts, never an amount. */
	warn?: (what: string, detail?: string) => void;
	/**
	 * The phone's outbox and acked list. After a pull, the acked writes it has
	 * seen are compared with the rows it brought and retired through it. Absent:
	 * no overlay and no write compare of entries.
	 */
	pending?: PendingSource;
	/** The zone the client renders in, for the compare's `zone` field; defaults to the runtime's. */
	browserZone?: () => string;
}

export function createDeviceEngine(
	api: DeviceApi,
	userId: string,
	now: () => number = Date.now,
	options: DeviceEngineOptions = {},
): DeviceEngine {
	const warn = options.warn ?? (() => undefined);
	let cursors: PullCursors = {};
	let storage: EngineStorage | null = null;
	let status: DeviceStatus = "idle";
	let generation = 0;
	/** Pulls begun, finished or not: a read that spans one is thrown away. */
	let pullsBegun = 0;
	/** `pullsBegun` as it was when the latest finished pull began; 0 before any. */
	let settledPull = 0;
	/** Entries already compared, so a list that is slow to retire one never has it compared twice. */
	const compared = new Set<string>();
	/** Bulk actions the server took, until a pull that began after the answer compares their rows. */
	const bulkSent = new Map<string, BulkSent>();
	/** When this phone last booked a write for each expense: a retired entry leaves the lists, the log stays. */
	const lastBooked = new Map<string, number>();
	let pulledAt: number | null = null;
	let inflight: Promise<void> | null = null;
	let lastCompare: CompareReport | null = null;
	/** Where each screen's next compare starts in its narrowed calls (the plan's rotation). */
	const rotation: Partial<Record<ScreenName, number>> = {};
	/** What the last pull counted past its `pastCut`, or null when it did not finish. */
	let lastPast: PulledPast | null = null;
	/** The server said this account is protected: it answers no figures, so no compare starts again. */
	let refused = false;
	const writeCounts: Record<string, number> = {};
	let writeRecent: WriteVerdict[] = [];
	let disposed = false;
	/** What a dispose asked for, for an open that finishes after it. */
	let wipeOnDispose = false;
	/** A reset emptied the store in the running pull: nothing is held until a pull completes. */
	let emptied = false;
	/** Commits the running pull has made: none means the rows are as the pull found them. */
	let commitsInPull = 0;

	const commit = (changes: readonly Change[]) => {
		// A disposed engine takes no more rows, so a pull in flight ends at its next write.
		if (disposed) throw new Error("The engine was disposed");
		commitsInPull += 1;
		storage?.persistence.commit(changes);
	};
	let store = new MemoryStore({ onCommit: commit });

	const hooks: StorageHooks = {
		cursors: () => cursors,
		onDegraded: (cause) => {
			warn("disk copy given up", cause);
			const given = storage;
			storage = null;
			given?.dispose({ wipe: true }).catch(() => undefined);
		},
	};

	/** Opens the disk copy and starts the store from it; memory-only when there is none. */
	async function attach(): Promise<void> {
		store = new MemoryStore({ onCommit: commit });
		cursors = {};
		if (!options.storage) return;
		let opened: EngineStorage | null = null;
		try {
			opened = await options.storage(hooks);
			if (opened === null) return;
			if (disposed) return await opened.dispose({ wipe: wipeOnDispose });
			store = new MemoryStore({
				rows: opened.loaded.rows,
				onCommit: commit,
			});
			cursors = opened.loaded.cursors;
			storage = opened;
			// Rows a pull ran to the end of are a whole copy: figures read from
			// them before any network.
			if (opened.loaded.complete) status = "ready";
		} catch (error) {
			// Rows the store would not take: the file is wiped and the engine
			// starts empty in memory.
			warn("disk copy unusable", (error as Error)?.name);
			store = new MemoryStore({ onCommit: commit });
			cursors = {};
			storage = null;
			await opened?.dispose({ wipe: true }).catch(() => undefined);
		}
	}

	/** The newest open of the disk copy, so a dispose waits for it and wipes what it made. */
	let opening = attach();
	/** The first open: nothing reads or pulls before the disk copy has been loaded. */
	const ready = opening;

	/** The server can no longer honor a cursor: nothing pulled with it can be trusted. */
	async function startOver(): Promise<void> {
		emptied = true;
		// The rows earlier commits wrote are gone with the old store.
		commitsInPull = 0;
		const old = storage;
		storage = null;
		await old?.dispose({ wipe: true });
		if (disposed) throw new Error("The engine was disposed");
		opening = attach();
		await opening;
		if (disposed) throw new Error("The engine was disposed");
	}

	/** What a pull counted past its cut, by entity. */
	const pastOf = (report: PullReport): PulledPast =>
		Object.fromEntries(
			Object.entries(report.entities).flatMap(([entity, step]) =>
				step.pastCut === undefined ? [] : [[entity, step.pastCut]],
			),
		);

	async function run(pastCut?: string): Promise<void> {
		await ready;
		if (disposed) return;
		// The phone's lists as they are now: a write saved since the last read counts.
		await options.pending?.refresh?.().catch(() => undefined);
		pullsBegun += 1;
		const mine = pullsBegun;
		const before = status;
		status = "pulling";
		commitsInPull = 0;
		emptied = false;
		storage?.persistence.beginPull();
		let pulled = false;
		lastPast = null;
		const pullOptions = pastCut === undefined ? {} : { pastCut };
		try {
			let report: PullReport;
			try {
				report = await pullAll(store, api, cursors, pullOptions);
			} catch (error) {
				if ((error as { code?: string } | null)?.code !== RESET_REQUIRED)
					throw error;
				await startOver();
				storage?.persistence.beginPull();
				report = await pullAll(store, api, cursors, pullOptions);
			}
			lastPast = pastOf(report);
			storage?.persistence.finishPull();
			generation += 1;
			settledPull = mine;
			pulledAt = now();
			status = "ready";
			pulled = true;
		} catch (error) {
			storage?.persistence.abandonPull();
			// A pull that stopped before its first write (offline) left the rows
			// as they were; one that stopped after it may have left them half
			// updated, so nothing reads them until a pull succeeds.
			// After a reset with no write since, the store holds nothing: idle, so
			// the next read pulls again.
			if (commitsInPull === 0 && emptied) status = "idle";
			else
				status = before === "ready" && commitsInPull === 0 ? "ready" : "failed";
			warn("pull failed", (error as Error)?.name);
		}
		// After the pull has settled, and apart from it: whatever the comparison
		// does, the pull stays as it ended.
		if (pulled && !disposed) {
			const counted = () => {
				writeCounts.error = (writeCounts.error ?? 0) + 1;
			};
			await compareEntries().catch(counted);
			compareBulkSent();
		}
	}

	/**
	 * Tallies verdicts and logs them: ids, field names and counts only, no
	 * amount ever reaches a log.
	 */
	function report(
		verdicts: readonly WriteVerdict[],
		expired: number,
		prefix = "",
	) {
		const bump = (key: string) => {
			writeCounts[key] = (writeCounts[key] ?? 0) + 1;
		};
		for (const v of verdicts)
			bump(
				`${prefix}${v.outcome === "skipped" ? `skipped:${v.code}` : v.outcome}`,
			);
		for (let i = 0; i < expired; i += 1) bump("expired");
		writeRecent = [...writeRecent, ...verdicts].slice(-RECENT_WRITES);
		if (verdicts.length === 0 && expired === 0) return;
		const findings = verdicts.filter((v) =>
			["differs", "rate_missing", "refused"].includes(v.outcome),
		);
		warn(
			findings.length > 0 ? "writes differ from the server" : "writes checked",
			JSON.stringify({
				checked: verdicts.length,
				expired,
				findings: findings.map((v) => ({
					id: v.id,
					outcome: v.outcome,
					...(v.outcome === "differs" ? { fields: v.fields } : {}),
				})),
				generation,
				clock: new Date(now()).toISOString(),
			}),
		);
	}

	/**
	 * Compares each acked write a finished pull has seen with the row the pull
	 * brought, once, on a committed snapshot, then retires it from the phone's
	 * list. Writes that left the list undone or aged out are counted as skips.
	 */
	async function compareEntries(): Promise<void> {
		const pending = options.pending;
		if (!pending) return;
		const entries = pending.entries();
		for (const id of compared)
			if (!entries.some((e) => e.clientId === id)) compared.delete(id);
		const retired = retiredBy(entries, settledPull).filter(
			(e) => !compared.has(e.clientId),
		);
		const left = pending.takeLeft();
		if (retired.length === 0 && left.length === 0) return;
		const snap = store.snapshot();
		const verdicts: WriteVerdict[] = [
			...retired.flatMap((e) =>
				e.changes.map((c) =>
					compareWrite(snap, c, {
						bookedAt: e.bookedAt,
						version: e.ack?.version ?? null,
					}),
				),
			),
			...left.flatMap(({ entry, code }) =>
				entry.changes.map(
					(c): WriteVerdict => ({ id: c.id, outcome: "skipped", code }),
				),
			),
		];
		for (const e of retired) compared.add(e.clientId);
		pending.retire(retired.map((e) => e.clientId));
		report(verdicts, 0);
	}

	/** Whether this phone booked a write for `id` at or after `since`, from the log and from the lists. */
	const bookedSince = (id: string, since: number): boolean =>
		(lastBooked.get(id) ?? Number.NEGATIVE_INFINITY) >= since ||
		(options.pending?.entries() ?? []).some(
			(e) => e.bookedAt >= since && e.changes.some((c) => c.id === id),
		);

	/** Compares each bulk action a finished pull has seen with the rows it brought, once. */
	function compareBulkSent(): void {
		const snap = store.snapshot();
		const verdicts: WriteVerdict[] = [];
		for (const [key, sent] of bulkSent) {
			if (settledPull <= sent.pull) continue;
			bulkSent.delete(key);
			for (const c of sent.changes)
				verdicts.push(
					compareBulkRow(snap, c, sent.bookedAt, {
						laterBooking: bookedSince(c.id, sent.bookedAt),
						serverAt: sent.serverAt,
					}),
				);
		}
		report(verdicts, 0);
	}

	const startPull = (pastCut?: string) => {
		inflight ??= run(pastCut).finally(() => {
			inflight = null;
		});
		return inflight;
	};
	const pull = () => startPull();

	/**
	 * A pull that begins after the call and counts the rows it brings in past
	 * `cut` (the server read's cut); null when it did not finish. A pull of
	 * another caller that began after the round's first server read (a foreground
	 * or another screen's pull), or was still running then, may have applied rows
	 * past the cut that nothing counted: it answers "again", so both sides are
	 * read once more. `mark` is the pulls begun when that read was asked for.
	 */
	async function pullPast(
		cut: string,
		mark: number | null,
	): Promise<PulledPast | "again" | null> {
		await ready;
		// A pull already running began before this call: wait it out.
		while (inflight) await inflight;
		const before = generation;
		await startPull(cut);
		if (generation <= before) return null;
		// Our own pull is the one begun since the read.
		return mark !== null && pullsBegun - mark !== 1 ? "again" : lastPast;
	}

	const pullIfStale = () =>
		inflight ??
		(pulledAt === null || now() - pulledAt >= PULL_AFTER_MS
			? pull()
			: Promise.resolve());

	async function dispose({ wipe }: { wipe: boolean }): Promise<void> {
		disposed = true;
		wipeOnDispose ||= wipe;
		// Closing first makes a pull in flight fail at its next write instead of
		// writing to a file that is about to go.
		const closing = storage;
		storage = null;
		closing?.persistence.close();
		await opening.catch(() => undefined);
		// An open that finished after `disposed` was set has already wiped what it made.
		await closing?.dispose({ wipe });
	}

	/** The budget verdict of the device's month at `at`, as the compare holds it, or null while the budget cannot be read. */
	async function verdictAt(at: Date): Promise<VerdictView | null> {
		if (budgetStatus(store) !== "ready") return null;
		const dto = await deviceMonthView(store, userId, () => at);
		if (!dto) return null;
		const { verdict } = dto;
		return {
			bookId: dto.book.id,
			currency: dto.book.currency,
			month: dto.month.key,
			today: dto.today,
			style: verdict.style,
			incomplete: monthVerdictIncomplete(dto),
			state: verdict.state,
			action: verdict.action,
			lead: { figureId: verdict.lead.figureId, amount: verdict.lead.amount },
		};
	}

	const browserZone = options.browserZone ?? (() => runtimeTimeZone() ?? "");

	/**
	 * The compare's view of the engine: the server's api, the store as the pulls
	 * left it, the clock. One per compare, which holds the pulls begun when each
	 * round's first server read was asked for.
	 */
	const depsForCompare = (): CompareDeps => {
		let mark: number | null = null;
		return {
			figures: {
				read(query) {
					// A pull still running fetches pages after the read too, so it counts as begun after it.
					mark ??= inflight ? pullsBegun - 1 : pullsBegun;
					return api.figures.read(query);
				},
			},
			async read(query) {
				const settings = store.get("settings", SETTINGS_ID);
				if (status !== "ready" || !settings) return null;
				const begun = pullsBegun;
				const known = query.ids.filter((id) => DEVICE_FIGURE_IDS.includes(id));
				const { readings } = await readDeviceFigures(
					store,
					userId,
					known,
					{ ...query.narrowing },
					() => query.at,
				);
				const verdict = query.verdict ? await verdictAt(query.at) : null;
				// A pull that began during the read changed the rows under it.
				return pullsBegun !== begun || status !== "ready"
					? null
					: { lines: readings, verdict };
			},
			pull(cut) {
				const since = mark;
				mark = null;
				return pullPast(cut, since);
			},
			cursors: () => cursors,
			ratesAsOf: () => ratesAsOf(store),
			settings: () => {
				const row = store.get("settings", SETTINGS_ID);
				return row
					? {
							homeCurrency: row.homeCurrency,
							timeZone: row.timeZone,
							startDay: row.startDay,
						}
					: null;
			},
			bookZone: () => store.list("budgetBooks")[0]?.timeZone ?? null,
			generation: () => generation,
			now: () => new Date(now()),
		};
	};

	async function readWithPending<R>(
		read: (view: Reader) => R | Promise<R>,
	): Promise<R | null> {
		try {
			await ready;
			if (disposed || status !== "ready") return null;
			const begun = pullsBegun;
			const value = await readOverlaid(
				store,
				options.pending?.entries() ?? [],
				settledPull,
				read,
			);
			// A pull that began during the read changed the rows under it.
			return pullsBegun !== begun || status !== "ready" ? null : value;
		} catch (error) {
			warn("overlay read failed", (error as Error)?.name);
			return null;
		}
	}

	async function book(op: WriteOp): Promise<BookedWrite | null> {
		lastBooked.set(targetOf(op), now());
		try {
			await ready;
			if (disposed || status !== "ready") return null;
			const begun = pullsBegun;
			const booked = await readOverlaid(
				store,
				options.pending?.entries() ?? [],
				settledPull,
				(tx) => bookIn(tx, op, cursors, now()),
			).catch((error) => {
				// A refusal is the domain's answer, not a fault: the server decides.
				if (
					error instanceof InvalidInputError ||
					error instanceof NotFoundError
				)
					return null;
				throw error;
			});
			return pullsBegun !== begun || status !== "ready" ? null : booked;
		} catch (error) {
			warn("booking failed", (error as Error)?.name);
			return null;
		}
	}

	async function bookBulk(op: BulkOp): Promise<BulkBooked | null> {
		try {
			await ready;
			if (disposed || status !== "ready") return null;
			const begun = pullsBegun;
			const booked = await readOverlaid(
				store,
				options.pending?.entries() ?? [],
				settledPull,
				(tx) => bookBulkIn(tx, op, cursors, now()),
			).catch((error) => {
				if (
					error instanceof InvalidInputError ||
					error instanceof NotFoundError
				)
					return null;
				throw error;
			});
			return pullsBegun !== begun || status !== "ready" ? null : booked;
		} catch (error) {
			warn("bulk booking failed", (error as Error)?.name);
			return null;
		}
	}

	async function comparePreviewBulk(
		op: BulkOp,
		server: ServerPreview,
	): Promise<WriteVerdict | null> {
		try {
			await ready;
			if (disposed || status !== "ready") return null;
			const verdict = await runBulkCompare(
				{
					store,
					userId,
					cursors,
					entries: options.pending?.entries() ?? [],
					settledPull,
					now: () => new Date(now()),
				},
				op,
				server,
			);
			report([verdict], 0, "preview:");
			return verdict;
		} catch (error) {
			warn("bulk preview check failed", (error as Error)?.name);
			return null;
		}
	}

	function settleBulk(
		key: string,
		booked: BulkBooked | null,
		answer: BulkAnswer,
		ids: readonly string[],
	): void {
		if (booked) report(answerVerdicts(booked, answer, ids), 0);
		// Rows the device could not book are held back too: the server may have moved them.
		const touched = booked ? booked.changes.map((c) => c.id) : [...ids];
		if (touched.length === 0) return;
		const at = Date.parse(answer.serverTime ?? "");
		bulkSent.set(key, {
			pull: pullsBegun,
			bookedAt: booked?.bookedAt ?? now(),
			changes: booked?.changes ?? [],
			ids: touched,
			serverAt: Number.isNaN(at) ? null : at,
		});
	}

	function undoneBulk(key: string): void {
		const sent = bulkSent.get(key);
		if (!sent) return;
		// The server put the rows back: they are not compared, and the store
		// holds the changed ones until a pull that begins now has seen it.
		bulkSent.set(key, { ...sent, pull: pullsBegun, changes: [] });
		report(
			sent.changes.map((c) => ({
				id: c.id,
				outcome: "skipped",
				code: "undone",
			})),
			0,
		);
	}

	const bulkUnsettled = (): ReadonlySet<string> =>
		new Set([...bulkSent.values()].flatMap((sent) => sent.ids));

	/** Reads the store as the last pull left it; null while it is not a whole copy. */
	async function readStored<R>(read: (view: Reader) => R): Promise<R | null> {
		try {
			await ready;
			if (disposed || status !== "ready") return null;
			return await readOverlaid(store, [], settledPull, read);
		} catch (error) {
			warn("stored read failed", (error as Error)?.name);
			return null;
		}
	}

	const storedRebase = (id: string) => readStored((view) => rebaseOf(view, id));

	async function absentSince(id: string, pull: number): Promise<boolean> {
		if (settledPull <= pull) return false;
		return (await readStored((view) => !view.get("expenses", id))) === true;
	}

	async function comparePreview(
		op: WriteOp,
		server: ServerPreview,
	): Promise<WriteVerdict | null> {
		try {
			await ready;
			if (disposed || status !== "ready") return null;
			const verdict = await runPreviewCompare(
				{
					store,
					userId,
					cursors,
					entries: options.pending?.entries() ?? [],
					settledPull,
					now: () => new Date(now()),
				},
				op,
				server,
			);
			report([verdict], 0, "preview:");
			return verdict;
		} catch (error) {
			warn("preview check failed", (error as Error)?.name);
			return null;
		}
	}

	async function compare(
		screen: ScreenName,
		narrowings: NarrowValues = {},
		serverVerdict?: () => Promise<VerdictView | null>,
	): Promise<CompareReport | null> {
		if (refused) return null;
		try {
			await ready;
			if (disposed) return null;
			const { report, next } = await compareScreen(depsForCompare(), {
				screen,
				values: narrowings,
				start: rotation[screen],
				browserZone: browserZone(),
				serverVerdict,
			});
			rotation[screen] = next;
			lastCompare = report;
			// Ids and counts only: `compareLine` reads named fields, never an amount.
			warn(COMPARE_WHAT, compareLine(report));
			return report;
		} catch (error) {
			// Advanced protection: the server answers no figures, so none are asked for again.
			if ((error as { code?: string } | null)?.code === "protected_account")
				refused = true;
			warn("check failed", (error as Error)?.name);
			return null;
		}
	}

	return {
		get status() {
			return status;
		},
		get generation() {
			return generation;
		},
		get pullsBegun() {
			return pullsBegun;
		},
		get lastCompare() {
			return lastCompare;
		},
		get writeParity() {
			return { counts: { ...writeCounts }, recent: [...writeRecent] };
		},
		get disposed() {
			return disposed;
		},
		readWithPending,
		book,
		storedRebase,
		absentSince,
		comparePreview,
		bookBulk,
		comparePreviewBulk,
		settleBulk,
		undoneBulk,
		bulkUnsettled,
		pull,
		pullIfStale,
		compare,
		dispose,
	};
}
