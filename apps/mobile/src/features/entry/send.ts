import type { RetrospendClient } from "@retrospend/api-client";
import type { ProblemCode } from "@retrospend/api-contract/errors";
import type { Outbox, OutboxEntry, OutboxKind } from "@/data/outbox";
import { originOf, PARKED_STAMP } from "@/data/outbox-chain";
import type { Sender, SendResult } from "@/data/sync";

// Sends the composers' outbox entries to API v1. The entry's client id is the
// idempotency key and the new row's id, so a retry after a lost answer
// replays the first response instead of writing a second row.

/** Where to send an undo token: each write family has its own undo route. */
export interface UndoRef {
	entity: EntryEntity;
	token: string;
	/** The row the write was about, when the sender knows it: undo checks nothing else waits on it. */
	target?: string;
	/** A recurring write's kind: a confirm and a skip undo through different routes. */
	kind?: OutboxKind;
}

export const ENTRY_ENTITIES = [
	"expenses",
	"shared-expenses",
	"income",
	"transfers",
	"recurring",
] as const;
export type EntryEntity = (typeof ENTRY_ENTITIES)[number];

export function isEntryEntity(entity: string): entity is EntryEntity {
	return (ENTRY_ENTITIES as readonly string[]).includes(entity);
}

/**
 * The one table of what this sender can send: a create of its own entities, an
 * update or delete of an expense, and a create, edit, confirm or skip of a
 * recurring template (only the dev flag queues those). A kind not listed for
 * its entity has no sender here (a template delete stays online) and must not
 * stop the queue.
 */
const SENDABLE: Record<EntryEntity, readonly OutboxKind[]> = {
	expenses: ["create", "update", "delete"],
	"shared-expenses": ["create"],
	income: ["create"],
	transfers: ["create"],
	recurring: ["create", "update", "confirm", "skip"],
};

const sendable = (e: OutboxEntry): e is OutboxEntry & { entity: EntryEntity } =>
	isEntryEntity(e.entity) && SENDABLE[e.entity].includes(e.kind);

/** The outbox as the composers' flush sees it: only what `sendable` names. */
export function entryOutbox(outbox: Outbox): Outbox {
	return {
		...outbox,
		pending: async () => (await outbox.pending()).filter(sendable),
		// The flush reads `all()`: `pending()` hides the parked entries its hold rule needs.
		all: async () => (await outbox.all()).filter(sendable),
	};
}

type Body<T> = T extends (input: infer I, ...rest: never[]) => unknown
	? I
	: never;

/** A server that keeps answering 5xx for one write is refusing it, not down. */
const MAX_SERVER_ERRORS = 3;
/** No answer for this long counts as no network; the write waits in the outbox. */
export const SEND_TIMEOUT_MS = 10_000;

/**
 * Answers that mean the server did not take the write, so a resend that gets
 * one of them proves there is nothing to undo. A 409 (a replay it can not
 * give back) or a 5xx says nothing about whether it holds the write.
 */
export const NOT_STORED_STATUSES: readonly number[] = [400, 403, 404, 422];

/** The codes a parked write is told apart by (Sync issues words them). */
export { PARKED_STAMP };
export const PARKED_NOT_FOUND = "not_found";
/** The server holds a different request under this key: never "not stored". */
export const KEY_REUSED = "idempotency_key_reused";
/** An update or delete with no stamp to check: never sent, never guessed. */
export const PARKED_NO_STAMP = "no_stamp";
/** A recurring confirm or skip that names no due date: never sent, never guessed. */
export const PARKED_NO_DUE = "no_due_date";
/**
 * The server's codes this sender branches on. The contract owns them
 * (PROBLEM_STATUS): typing each by `ProblemCode` makes a misspelled or retired
 * one fail the typecheck instead of silently never matching.
 */
const problem = <C extends ProblemCode>(code: C): C => code;
/** The id a confirm named for its expense is held by another row: nothing was booked. */
export const PARKED_ID_TAKEN = problem("id_taken");
/** The server read the account as protected: the run stops and the entry stays. */
export const PROTECTED_ACCOUNT = problem("protected_account");
/** The server's typed answers to a recurring write that name why it did not book. */
export const RECURRING_ALREADY_POSTED = problem("recurring_already_posted");
export const RECURRING_NOT_DUE = problem("recurring_not_due");
export const RECURRING_CHANGED = problem("recurring_changed");

/** The server answered that it did not take the write, and said nothing of an earlier try. */
export function notStored(sent: { http?: number; reason: string }): boolean {
	return (
		sent.http !== undefined &&
		NOT_STORED_STATUSES.includes(sent.http) &&
		sent.reason !== KEY_REUSED
	);
}

/** What the server said the first time, kept so Undo can find the token. */
const sentTokens = new Map<string, UndoRef>();
const MAX_TOKENS = 50;

export function rememberUndo(clientId: string, ref: UndoRef): void {
	sentTokens.set(clientId, ref);
	// Oldest first: a Map iterates in insertion order.
	while (sentTokens.size > MAX_TOKENS) {
		const oldest = sentTokens.keys().next().value;
		if (oldest === undefined) break;
		sentTokens.delete(oldest);
	}
}

/** Test seam: forget every kept token. */
export function forgetUndoTokens(): void {
	sentTokens.clear();
}

export function undoFor(clientId: string): UndoRef | undefined {
	return sentTokens.get(clientId);
}

/**
 * What parks a write to an existing row when the row may be gone or settled
 * elsewhere: API v1 answers 404 for a gone row; the vault answers 409 for a
 * gone row and a changed one alike. A person's recurring write answered "already
 * posted" or "changed" waits for the same thing: a pull that shows the template.
 */
export const MAYBE_GONE: readonly string[] = [
	PARKED_NOT_FOUND,
	PARKED_STAMP,
	RECURRING_ALREADY_POSTED,
	RECURRING_CHANGED,
];

/**
 * The `pullsBegun` reading when a send of an update or delete was parked for
 * `MAYBE_GONE`. A pull numbered above it began after the answer, so only such
 * a pull can show that the row is gone. Memory only: a parked entry read from disk has
 * none, and any pull of the new run began after its answer.
 */
const notFoundAt = new Map<string, number>();

export const notFoundPull = (clientId: string): number =>
	notFoundAt.get(clientId) ?? 0;

export function forgetNotFound(clientId: string): void {
	notFoundAt.delete(clientId);
}

/** A client-made id that the server already holds: an earlier try got through. */
function idTaken(error: unknown): boolean {
	return (error as { code?: string } | null)?.code === "id_taken";
}

/**
 * What a recurring confirm or skip is told apart by (null: the common rules
 * decide). A poster entry was planned over a template that has since moved, so
 * "already posted" and "changed" end it silently and the next run plans again.
 * A person's entry parks and waits for a pull: nothing a person typed
 * disappears without a word.
 */
function recurringAnswer(
	entry: Pick<OutboxEntry, "origin">,
	reason: string,
	http: number,
): SendResult | null {
	switch (reason) {
		case RECURRING_ALREADY_POSTED:
		case RECURRING_CHANGED:
			return originOf(entry) === "poster"
				? { status: "retired" }
				: { status: "conflict", reason, http };
		// The day has not come: waits, never parked, never held against it.
		case RECURRING_NOT_DUE:
			return { status: "later" };
		// Protection turned on: nothing more goes this run, and the entry stays.
		case PROTECTED_ACCOUNT:
			return { status: "retry", reason, kind: "network" };
		default:
			return null;
	}
}

/**
 * Network failures and server trouble retry; a refused write is parked.
 * `serverErrors` is how often this write already met a 5xx: a write must not
 * hold the whole queue forever behind a server error that never clears.
 * `entry` is the write it answers, for the answers that depend on it.
 */
export function classify(
	error: unknown,
	serverErrors = 0,
	entry?: Pick<OutboxEntry, "entity" | "origin">,
): SendResult {
	const { status, code } = (error ?? {}) as { status?: number; code?: string };
	const reason = code ?? (error instanceof Error ? error.message : "unknown");
	// No status: the request never got an answer (offline, timeout).
	if (status === undefined) return { status: "retry", reason, kind: "network" };
	// A 401 ends the session on its own; the write waits for the next sign in.
	// A token without the scope may get it after a re-authorization.
	if (
		status === 401 ||
		status === 408 ||
		status === 429 ||
		code === "missing_scope" ||
		code === "idempotency_in_progress"
	) {
		return { status: "retry", reason, kind: "network" };
	}
	if (status >= 500) {
		return serverErrors >= MAX_SERVER_ERRORS
			? { status: "conflict", reason, http: status }
			: { status: "retry", reason, kind: "server" };
	}
	if (entry?.entity === "recurring") {
		const typed = recurringAnswer(entry, reason, status);
		if (typed) return typed;
	}
	// 400, 403, 404, 409, 422: the server read it and said no.
	return { status: "conflict", reason, http: status };
}

/**
 * What differs between where a write goes: the request and the undo. The
 * policy around them (stamps, classify, counters, the 404 note) is one owner,
 * `createEntrySender`; the sealed vault (K9) is another transport under it.
 */
export interface Transport {
	dispatch(entry: OutboxEntry, options: CallOptions): Promise<Created>;
	/** `key` is the undo's idempotency key (`undoKey`). */
	undo(ref: UndoRef, key: string): Promise<void>;
}

/** API v1, the transport of every build today. */
export const apiTransport = (api: RetrospendClient): Transport => ({
	dispatch: (entry, options) => dispatch(api, entry, options),
	undo: (ref, key) => undoWithKey(api, ref, key),
});

export interface SenderOptions {
	/** Stops the run: the account changed, so nothing more is sent. */
	signal?: AbortSignal;
	/** `DeviceEngine.pullsBegun`, read when a 404 or a conflict arrives. */
	pullsBegun?: () => number;
	/** Writes a sealed request into its entry (`Outbox.seal`). */
	keepSealed?: (clientId: string, bytes: string) => Promise<void>;
}

/** The sender for the composers' entities. Undo tokens are kept for Undo. */
export function createEntrySender(
	transport: Transport,
	options: SenderOptions = {},
): Sender {
	return async (entry) => {
		if (!sendable(entry)) {
			return {
				status: "retry",
				reason: `no sender for ${entry.kind} of ${entry.entity}`,
			};
		}
		if (options.signal?.aborted) {
			return { status: "retry", reason: "aborted", kind: "network" };
		}
		// A write to an existing row is checked against the version it was based
		// on; with none it would overwrite or delete unchecked.
		if (entry.kind !== "create" && typeof entry.baseVersion !== "string") {
			return { status: "conflict", reason: PARKED_NO_STAMP };
		}
		if (
			(entry.kind === "confirm" || entry.kind === "skip") &&
			!recurringPayloadOf(entry)
		)
			return { status: "conflict", reason: PARKED_NO_DUE };
		const timeout = new AbortController();
		const timer = setTimeout(() => timeout.abort(), SEND_TIMEOUT_MS);
		const stop = () => timeout.abort();
		options.signal?.addEventListener("abort", stop);
		try {
			const { undo: token, version } = await transport.dispatch(entry, {
				context: { idempotencyKey: entry.clientId },
				signal: timeout.signal,
				sealed: {
					bytes: entry.sealed,
					keep: (bytes) =>
						options.keepSealed?.(entry.clientId, bytes) ?? Promise.resolve(),
				},
			});
			rememberUndo(entry.clientId, {
				entity: entry.entity,
				token,
				target: entry.targetId,
				...(entry.entity === "recurring" ? { kind: entry.kind } : {}),
			});
			// A delete names null: nothing chained after it has a version to take.
			return {
				status: "sent",
				...(version !== undefined ? { version } : {}),
			};
		} catch (error) {
			// The id exists: an earlier try went through and its answer got lost.
			// No answer, so no version: an entry chained after it parks as
			// chain_lost, and Try again re-bases it over the pulled row. Not for
			// a template: the key replays a create that landed, so a taken id
			// is another row's and nothing was made (it parks).
			if (
				entry.kind === "create" &&
				entry.entity !== "recurring" &&
				idTaken(error)
			)
				return { status: "sent" };
			const result = classify(error, entry.serverErrors, entry);
			if (
				entry.kind !== "create" &&
				result.status === "conflict" &&
				(result.http === 404 || MAYBE_GONE.includes(result.reason))
			) {
				notFoundAt.set(entry.clientId, options.pullsBegun?.() ?? 0);
			}
			return result;
		} finally {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", stop);
		}
	};
}

export interface CallOptions {
	context: { idempotencyKey: string };
	signal: AbortSignal;
	/**
	 * A transport that seals reads `bytes` first and seals only when there are
	 * none, then awaits `keep` before its request leaves: the entry is where
	 * sealed bytes live, so a restart or a rebuilt transport resends them.
	 */
	sealed: { bytes: string | undefined; keep(bytes: string): Promise<void> };
}

/**
 * The undo token, and for an expense or a template the `updatedAt` the server
 * booked it at (null for a delete: the row is gone). A template create or
 * edit has no server token: `NO_TOKEN`, and its undo is written by the phone.
 */
export interface Created {
	undo: string;
	version?: string | null;
}

export const NO_TOKEN = "";

/** An edit of a template (PATCH), checked against the template version the entry was based on. */
async function editTemplate(
	api: RetrospendClient,
	entry: OutboxEntry,
	options: CallOptions,
): Promise<Created> {
	// `title` is kept for the Sync issues row and never sent.
	const { title: _title, ...patch } = entry.payload as Omit<
		Body<typeof api.recurring.update>,
		"id" | "expectedUpdatedAt"
	> & { title?: string };
	const written = await api.recurring.update(
		{
			...patch,
			id: entry.targetId,
			expectedUpdatedAt: entry.baseVersion as string,
		},
		options,
	);
	return { undo: NO_TOKEN, version: written.updatedAt };
}

/** An update or delete of an expense, or an edit of a template, checked against the version the entry was based on. */
async function change(
	api: RetrospendClient,
	entry: OutboxEntry,
	options: CallOptions,
): Promise<Created> {
	if (entry.entity === "recurring" && entry.kind === "update")
		return editTemplate(api, entry, options);
	if (entry.entity !== "expenses")
		throw new Error(`no ${entry.kind} of ${entry.entity}`);
	const expectedUpdatedAt = entry.baseVersion as string;
	if (entry.kind === "delete") {
		const gone = await api.expenses.delete(
			{ params: { id: entry.targetId }, query: { expectedUpdatedAt } },
			options,
		);
		return { undo: gone.undo, version: null };
	}
	const written = await api.expenses.update(
		{
			...(entry.payload as Omit<
				Body<typeof api.expenses.update>,
				"expectedUpdatedAt"
			>),
			expectedUpdatedAt,
		},
		options,
	);
	return { undo: written.undo, version: written.expense?.updatedAt };
}

/**
 * Each kind goes to its own call, so a confirm or skip can never go out as a
 * PUT of an expense under a template's id. A kind this sender does not know,
 * or one aimed at an entity that has no such call, throws before any request.
 */
async function dispatch(
	api: RetrospendClient,
	entry: OutboxEntry,
	options: CallOptions,
): Promise<Created> {
	switch (entry.kind) {
		case "create":
			return create(api, entry, options);
		case "update":
		case "delete":
			return change(api, entry, options);
		case "confirm":
		case "skip":
			return settle(api, entry, options);
		default:
			throw new Error(`no sender for ${String(entry.kind)}`);
	}
}

/** What a recurring entry's payload holds. The template is `targetId`, its stamp `baseVersion`, the booked expense's id `clientId`. */
export interface RecurringPayload {
	/** The due instant being settled (ISO): a period already settled is refused, never booked twice. */
	dueAt: string;
	/** Confirm only: the typed amount of an "Amount varies" template. */
	amount?: string;
	/** Confirm only: the day it was really paid (yyyy-MM-dd). */
	paidOn?: string;
	/** The template's name, kept for the Sync issues row. Never sent. */
	title?: string;
	/** The template's currency, kept for the Sync issues row. Never sent. */
	currency?: string;
}

/** The payload as a recurring write needs it, or null when it names no due date. */
export function recurringPayloadOf(
	entry: Pick<OutboxEntry, "payload">,
): RecurringPayload | null {
	const body = entry.payload as Partial<RecurringPayload> | null;
	return typeof body?.dueAt === "string" &&
		Number.isFinite(Date.parse(body.dueAt))
		? (body as RecurringPayload)
		: null;
}

/**
 * A confirm or skip of a template, checked against the template version it
 * was based on. A confirm names its booked expense by the entry's client id,
 * so the phone's row and the server's are one. The answer names the
 * template's version after the write: the next entry for it takes that.
 */
async function settle(
	api: RetrospendClient,
	entry: OutboxEntry,
	options: CallOptions,
): Promise<Created> {
	const body = recurringPayloadOf(entry);
	if (entry.entity !== "recurring" || !body)
		throw new Error(`no ${entry.kind} of ${entry.entity}`);
	const stamped = {
		id: entry.targetId,
		dueAt: body.dueAt,
		expectedUpdatedAt: entry.baseVersion as string,
	};
	if (entry.kind === "skip") {
		const skipped = await api.recurring.skip(stamped, options);
		return { undo: skipped.undo, version: skipped.skipped.templateUpdatedAt };
	}
	const confirmed = await api.recurring.confirm(
		{
			...stamped,
			expenseId: entry.clientId,
			...(body.amount !== undefined ? { amount: body.amount } : {}),
			...(body.paidOn !== undefined ? { paidOn: body.paidOn } : {}),
		},
		options,
	);
	return {
		undo: confirmed.undo,
		version: confirmed.confirmed.templateUpdatedAt,
	};
}

async function create(
	api: RetrospendClient,
	entry: OutboxEntry,
	options: CallOptions,
): Promise<Created> {
	switch (entry.entity as EntryEntity) {
		case "expenses": {
			const written = await api.expenses.create(
				entry.payload as Body<typeof api.expenses.create>,
				options,
			);
			return { undo: written.undo, version: written.expense?.updatedAt };
		}
		case "shared-expenses":
			return {
				undo: (
					await api["shared-expenses"].create(
						entry.payload as Body<(typeof api)["shared-expenses"]["create"]>,
						options,
					)
				).undo,
			};
		case "income":
			return {
				undo: (
					await api.income.create(
						entry.payload as Body<typeof api.income.create>,
						options,
					)
				).undo,
			};
		case "transfers":
			return {
				undo: (
					await api.transfers.create(
						entry.payload as Body<typeof api.transfers.create>,
						options,
					)
				).undo,
			};
		case "recurring": {
			// The template takes the entry's client id, so the server's row and the phone's are one.
			const made = await api.recurring.create(
				{
					...(entry.payload as Omit<Body<typeof api.recurring.create>, "id">),
					id: entry.clientId,
				},
				options,
			);
			return { undo: NO_TOKEN, version: made.updatedAt };
		}
	}
}

/**
 * The key of an undo. A write undone under the dev flag has a generation
 * (`outbox.nextUndoGeneration`), so a second undo is a new request; without
 * one the key is as it always was.
 */
export const undoKey = (clientId: string, generation?: number): string =>
	generation === undefined
		? `${clientId}-undo`
		: `${clientId}-undo-${generation}`;

/** Puts a saved write back through the transport, under the undo key of this generation. */
export function undoWith(
	transport: Transport,
	ref: UndoRef,
	clientId: string,
	generation?: number,
): Promise<void> {
	return transport.undo(ref, undoKey(clientId, generation));
}

async function undoWithKey(
	api: RetrospendClient,
	ref: UndoRef,
	key: string,
): Promise<void> {
	const timeout = new AbortController();
	const timer = setTimeout(() => timeout.abort(), SEND_TIMEOUT_MS);
	const options = {
		context: { idempotencyKey: key },
		signal: timeout.signal,
	};
	const input = { token: ref.token };
	try {
		if (ref.entity === "expenses") await api.expenses.undo(input, options);
		else if (ref.entity === "shared-expenses") {
			await api["shared-expenses"].undo(input, options);
		} else if (ref.entity === "transfers") {
			await api.transfers.undo(input, options);
		} else if (ref.entity === "recurring") {
			// A confirm and a skip are undone by different routes: never guess.
			if (ref.kind === "confirm") await api.recurring.undo(input, options);
			else if (ref.kind === "skip")
				await api.recurring.undoSkip(input, options);
			// A new template is undone by deleting it (nothing was booked from it yet).
			else if (ref.kind === "create" && ref.target)
				await api.recurring.delete({ id: ref.target }, options);
			// An edit has no server undo: the phone writes the old values back.
			else throw new Error("An undo of a recurring write needs its kind");
		} else await api.income.undo(input, options);
	} finally {
		clearTimeout(timer);
	}
}
