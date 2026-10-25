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
/**
 * The only field names the walker descends through. They come from the
 * contract's own DTOs. A key outside this list could be a map keyed by what
 * a person typed (`{ byName: { Groceries: ... } }`), and a typed key must
 * never become part of a name. Array positions are numbers, not keys, so
 * they always pass. Add a name here when a DTO adds a nested field.
 */
const KNOWN_SEGMENTS: ReadonlySet<string> = new Set(
	`value result results entry entries item items row rows change changes
	expense expenses income transfer transfers payment payments person people
	project projects account accounts category categories envelope envelopes
	shared sharedExpense share shares movement draft rule group debt book
	month settlement participant participants leg legs fee source target
	from to before after delta current next previous original home foreign
	amount amounts total balance available assigned spent left limit paid
	owed received sent held holds need interest principal minimum savings
	worth part mine rest short over carry cost price base typed suggested
	activity booked charged confirmStartingMoney difference effect imbalance
	lines moneyIn netWorth owedToYou youOwe withMe myShare myBalance
	toAssign uncovered usualPerDay perDay perMonth year quarter progress
	revaluation returned pending full everything net`
		.split(/\s+/)
		.filter(Boolean),
);
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
				} else if (
					typeof child === "object" &&
					child !== null &&
					KNOWN_SEGMENTS.has(key)
				) {
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
