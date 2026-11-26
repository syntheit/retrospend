import type { PendingChange } from "@retrospend/engine/device";
import { decodeRow, encodeRow } from "./engine-db/serialize";
import type {
	BaseVersion,
	DeviceBooking,
	NewOutboxEntry,
	OutboxEntry,
	OutboxOrigin,
} from "./outbox";

// The rules that keep a chain of writes to one row in order: who waits on
// whom, what a stamp is written into, and how an entry is stored. Pure
// functions over entries; outbox.ts owns the store and the order of steps.

/**
 * The columns of each table that hold a person's text. The outbox is a plain
 * key-value store, so a `device` row never keeps them (design item 2). Each
 * list is a copy of the engine's (EXPENSE_TEXT_COLUMNS, TEMPLATE_STRIPPED_COLUMNS):
 * the engine stays out of a release bundle, so it cannot be imported here.
 * outbox.test holds each equal to its engine list, so a new text column fails
 * there; the table key makes a new table in `PendingChange` fail to compile.
 */
export const DEVICE_TEXT_COLUMNS = {
	expenses: ["title", "description", "location"],
	recurringTemplates: ["name", "websiteUrl", "paymentSource", "category"],
} as const satisfies Record<PendingChange["table"], readonly string[]>;

export const PARKED_CHAIN_LOST = "chain_lost";
/** The server holds a newer version of the row than the entry was based on. */
export const PARKED_STAMP = "expense_changed";
/** An entry being taken out of line: parked first, so a crash never sends it. */
export const PARKED_DISCARDING = "discarding";
const REPLACED = "replaced:";
/** An entry being swapped for `clientId`: parked until the swap is done. */
export const parkedReplacedBy = (clientId: string) => `${REPLACED}${clientId}`;
/** The client id an entry was being replaced by, or null when it was not. */
export const replacementOf = (entry: OutboxEntry): string | null =>
	entry.state === "conflict" && entry.lastError?.startsWith(REPLACED)
		? entry.lastError.slice(REPLACED.length)
		: null;

/**
 * The text columns of `table`. A table that has no list throws: a row of a
 * table nobody declared text for is never kept (fail closed), whatever its
 * type said at compile time (an entry can come from a script or an old build).
 */
function textColumnsOf(table: string): readonly string[] {
	if (!Object.hasOwn(DEVICE_TEXT_COLUMNS, table))
		throw new Error(`Outbox: unknown table "${table}" has no text columns`);
	return DEVICE_TEXT_COLUMNS[table as PendingChange["table"]];
}

function bare<R extends object | null>(table: string, row: R): R {
	if (row === null) return row;
	const out: Record<string, unknown> = { ...row };
	for (const column of textColumnsOf(table)) delete out[column];
	return out as R;
}

/** `device` as the outbox may keep it: every row without its text. */
export function withoutDeviceText(device: DeviceBooking): DeviceBooking {
	return {
		...device,
		changes: device.changes.map(
			(c): PendingChange =>
				c.table === "expenses"
					? {
							...c,
							before: bare(c.table, c.before),
							after: bare(c.table, c.after),
						}
					: {
							...c,
							before: bare(c.table, c.before),
							after: bare(c.table, c.after),
						},
		),
	};
}

/** Who made the entry. Entries written before `origin` existed were a person's. */
export const originOf = (entry: Pick<OutboxEntry, "origin">): OutboxOrigin =>
	entry.origin ?? "user";

/**
 * A poster entry always carries its template's stamp: a transport cannot say
 * the post was automatic, so the stamp is the only guard against posting after
 * the template was changed elsewhere (revision 3, item 2). Refused in the
 * shape of the entry, not in a comment.
 */
export function assertStamped(entry: NewOutboxEntry): void {
	if (entry.origin === "poster" && entry.baseVersion === null)
		throw new Error("A poster entry needs the template's version or a chain");
}

/** Whether `entry` waits for `clientId` to be acked and wrote its version. */
export function isChainedTo(entry: OutboxEntry, clientId: string): boolean {
	const base = entry.baseVersion;
	return typeof base === "object" && base !== null && base.after === clientId;
}

/**
 * The ids among `ids` that an entry (open, parked or acked) still names as its
 * target, or that `alsoNamed` holds: bulk actions the server took and no pull
 * has settled, which never enter the outbox. The one "this row is not synced"
 * check: the queue's undo and the phone's bulk actions read it.
 */
export function targetsWithEntries(
	entries: readonly Pick<OutboxEntry, "targetId">[],
	ids: readonly string[],
	alsoNamed: ReadonlySet<string> = new Set(),
): string[] {
	const named = new Set(entries.map((e) => e.targetId));
	return ids.filter((id) => named.has(id) || alsoNamed.has(id));
}

export const isUnresolved = (base: BaseVersion): base is { after: string } =>
	typeof base === "object" && base !== null;

/**
 * The table of the row an entity's writes are about: the row whose version an
 * ack names (an expense's `updatedAt`, a confirm's `templateUpdatedAt`). An
 * entity not listed names no row, so no booked row is stamped for it.
 */
const ENTITY_TABLE: Readonly<Record<string, PendingChange["table"]>> = {
	expenses: "expenses",
	recurring: "recurringTemplates",
};

const rowKey = (change: { table: string; id: string }) =>
	`${change.table}:${change.id}`;

/**
 * What an entry takes when the entry before it is acked at `version`: its
 * base, and the version of its `before` row that the acked one wrote (a
 * device-booked row has none until its ack, and the overlay finds the base of
 * a stacked entry by it). Rows are keyed by table and id, and only the row the
 * ack names is stamped: a confirm also books an expense, whose own version the
 * answer does not carry, so it never takes the template's.
 */
export function stampedBy(
	dependent: OutboxEntry,
	acked: OutboxEntry,
	version: string,
): Partial<OutboxEntry> {
	const table = Object.hasOwn(ENTITY_TABLE, acked.entity)
		? ENTITY_TABLE[acked.entity]
		: undefined;
	const named = table && rowKey({ table, id: acked.targetId });
	const wrote = acked.device?.changes.some((c) => rowKey(c) === named);
	const device = dependent.device && {
		...dependent.device,
		changes: dependent.device.changes.map((c): PendingChange => {
			if (!wrote || !c.before || rowKey(c) !== named) return c;
			return c.table === "expenses"
				? { ...c, before: { ...c.before, version } }
				: { ...c, before: { ...c.before, version } };
		}),
	};
	return { baseVersion: version, ...(device ? { device } : {}) };
}

/** A chain that resolves to nothing is parked, never sent. */
export const chainLost: Partial<OutboxEntry> = {
	state: "conflict",
	lastError: PARKED_CHAIN_LOST,
};

/** An entry as one string: dates and decimals survive the trip (engine-db/serialize). */
export function encodeEntry(entry: OutboxEntry): string {
	const { seq: _seq, device, ...rest } = entry;
	return JSON.stringify({
		...rest,
		...(device ? { device: encodeRow(withoutDeviceText(device)) } : {}),
	});
}

export function decodeEntry(text: string, seq: number): OutboxEntry {
	const stored = JSON.parse(text) as Omit<OutboxEntry, "device"> & {
		device?: string;
	};
	const { device, ...rest } = stored;
	return {
		...rest,
		// Entries written before the counters existed read as zero.
		networkFailures: rest.networkFailures ?? 0,
		serverErrors: rest.serverErrors ?? 0,
		seq,
		...(device ? { device: decodeRow(device) as DeviceBooking } : {}),
	};
}
