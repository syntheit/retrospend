import {
	currencyCodeSchema,
	EVENT_DATA_LIMIT,
	EVENT_ID_PATTERN,
	type EventData,
} from "@retrospend/api-contract";

/**
 * What an event may carry (owner rule 4): ids, types and amounts, never
 * titles or notes. Nothing here copies a string because it looks useful:
 * the walker below keeps a value only when its key says it is an id and it
 * has the shape of one, or when it is a Money. Everything else, text
 * included, is dropped, so a new field added to a result cannot leak into
 * an event.
 */

const MAX_DEPTH = 4;
/** Keys that hold an undo recipe or a guard, not the write's own result. */
const SKIP_KEYS = new Set(["plan", "stamp", "undo", "args", "guard", "userId"]);
/** A key that is safe to put in a name: no free text can have this shape and a dot. */
const NAME_SEGMENT = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const ID_KEY = /^(id|[a-z][A-Za-z0-9]*Id)$/;

type Walked = {
	/** The shallowest `id` of the value: the thing the write is about. */
	entityId: string | null;
	data: EventData;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
	if (typeof v !== "object" || v === null) return false;
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
}

function isMoney(v: Record<string, unknown>): boolean {
	return (
		typeof v.minor === "number" &&
		Number.isSafeInteger(v.minor) &&
		typeof v.currency === "string" &&
		currencyCodeSchema.safeParse(v.currency).success
	);
}

/** Ids and Money found in `value`, shallowest first, capped. */
export function extractEventData(value: unknown): Walked {
	const ids: Record<string, string> = {};
	const amounts: EventData["amounts"] = [];
	let entityId: string | null = null;
	let truncated = false;

	let level: { path: string[]; node: unknown }[] = [{ path: [], node: value }];
	for (let depth = 0; depth <= MAX_DEPTH && level.length > 0; depth++) {
		const next: typeof level = [];
		for (const { path, node } of level) {
			if (Array.isArray(node)) {
				node.forEach((item, i) => {
					next.push({ path: [...path, String(i)], node: item });
				});
				continue;
			}
			if (!isPlainObject(node)) continue;
			if (path.length > 0 && isMoney(node)) {
				if (amounts.length >= EVENT_DATA_LIMIT) truncated = true;
				else
					amounts.push({
						name: path.join("."),
						minor: node.minor as number,
						currency: node.currency as string,
					});
				continue;
			}
			for (const [key, child] of Object.entries(node)) {
				if (SKIP_KEYS.has(key) || !NAME_SEGMENT.test(key)) continue;
				if (typeof child === "string") {
					if (!ID_KEY.test(key) || !EVENT_ID_PATTERN.test(child)) continue;
					if (key === "id" && entityId === null) {
						entityId = child;
						continue;
					}
					if (Object.keys(ids).length >= EVENT_DATA_LIMIT) truncated = true;
					else ids[[...path, key].join(".")] = child;
				} else if (typeof child === "object" && child !== null) {
					next.push({ path: [...path, key], node: child });
				}
			}
		}
		level = next;
	}
	return { entityId, data: { ids, amounts, truncated } };
}

/** The signed movement of each figure a mutation changed, from its preview diff. */
export function amountsOfChanges(
	changes: readonly {
		id: string;
		delta: { minor: number; currency: string };
	}[],
): EventData["amounts"] {
	return changes
		.filter((c) => c.delta.minor !== 0)
		.slice(0, EVENT_DATA_LIMIT)
		.map((c) => ({
			name: c.id,
			minor: c.delta.minor,
			currency: c.delta.currency,
		}));
}
