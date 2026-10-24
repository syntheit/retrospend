/**
 * The filter grammar of `GET /expenses?filter=` (IMPLEMENTATION §2.2: the
 * same grammar as the web). It is the query string of the web's Activity
 * page, so a link copied from the app works as a filter here:
 *
 *   from=2026-10-01&to=2026-10-31&cat=ID,ID&kind=expense,in&q=coffee
 *
 * - `from`, `to`: YYYY-MM-DD, inclusive, in the caller's time zone.
 * - `cat`, `project`: comma-separated ids.
 * - `person`: comma-separated person keys (`user:ID`, `shadow:ID`, `guest:ID`).
 * - `paidby`: `me` and/or person keys.
 * - `kind`: comma-separated kinds (ACTIVITY_KINDS).
 * - `q`: text matched in titles, notes and amounts, ignoring case and
 *   accents. It is opaque to the server (no trimming or case folding here).
 * - `range=all`: accepted and ignored. Unlike the web page, no dates means
 *   every date.
 *
 * Values are percent-encoded. A key twice, an unknown key and a malformed
 * value are all refused (`invalid_filter`), never ignored.
 */

export const ACTIVITY_KINDS = [
	"expense",
	"in",
	"refund",
	"transfer",
	"reimbursement",
	"payment",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const FILTER_LIST_MAX = 50;
export const FILTER_TEXT_MAX = 100;

export type ActivityFilterValue = {
	from?: string;
	to?: string;
	categoryIds?: string[];
	projectIds?: string[];
	people?: string[];
	paidBy?: string[];
	kinds?: ActivityKind[];
	q?: string;
};

export type FilterParse =
	| { ok: true; value: ActivityFilterValue }
	| { ok: false; message: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PERSON = /^(user|shadow|guest):[\w-]+$/;
const KEYS = [
	"from",
	"to",
	"cat",
	"person",
	"project",
	"paidby",
	"kind",
	"q",
	"range",
] as const;

function isDay(value: string): boolean {
	if (!DAY.test(value)) return false;
	const date = new Date(`${value}T00:00:00.000Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function listOf(value: string): string[] {
	return value.split(",").filter(Boolean);
}

/** Parses a `filter` value; nothing throws, a refusal carries its reason. */
export function parseActivityFilter(raw: string | undefined): FilterParse {
	const value: ActivityFilterValue = {};
	if (raw === undefined || raw === "") return { ok: true, value };
	const params = new URLSearchParams(raw);
	const seen = new Set<string>();
	for (const [key] of params) {
		if (!(KEYS as readonly string[]).includes(key))
			return { ok: false, message: `Unknown filter key "${key}"` };
		if (seen.has(key))
			return { ok: false, message: `Filter key "${key}" appears twice` };
		seen.add(key);
	}

	const need = (
		key: string,
		check: (v: string) => boolean,
		what: string,
	): string | null => {
		const v = params.get(key);
		if (v === null) return null;
		if (!check(v)) throw new FilterError(`"${key}" must be ${what}`);
		return v;
	};
	const list = (
		key: string,
		check: (v: string) => boolean,
		what: string,
	): string[] | undefined => {
		const v = params.get(key);
		if (v === null) return undefined;
		const items = listOf(v);
		if (items.length === 0 || items.length > FILTER_LIST_MAX)
			throw new FilterError(
				`"${key}" takes 1 to ${FILTER_LIST_MAX} comma-separated values`,
			);
		if (!items.every(check)) throw new FilterError(`"${key}" must be ${what}`);
		return items;
	};
	const id = (v: string) => v.length >= 1 && v.length <= 64;

	try {
		const from = need("from", isDay, "a day like 2026-10-01");
		if (from) value.from = from;
		const to = need("to", isDay, "a day like 2026-10-31");
		if (to) value.to = to;
		need("range", (v) => v === "all", "all");
		const cat = list("cat", id, "category ids");
		if (cat) value.categoryIds = cat;
		const project = list("project", id, "project ids");
		if (project) value.projectIds = project;
		const person = list(
			"person",
			(v) => v.length <= 80 && PERSON.test(v),
			"person keys like user:ID",
		);
		if (person) value.people = person;
		const paidBy = list(
			"paidby",
			(v) => v === "me" || (v.length <= 80 && PERSON.test(v)),
			"me or person keys like user:ID",
		);
		if (paidBy) value.paidBy = paidBy;
		const kinds = list(
			"kind",
			(v) => (ACTIVITY_KINDS as readonly string[]).includes(v),
			`one of ${ACTIVITY_KINDS.join(", ")}`,
		);
		if (kinds) value.kinds = kinds as ActivityKind[];
		const q = params.get("q");
		if (q !== null) {
			if (q.length === 0 || q.length > FILTER_TEXT_MAX)
				throw new FilterError(`"q" takes 1 to ${FILTER_TEXT_MAX} characters`);
			value.q = q;
		}
	} catch (error) {
		if (error instanceof FilterError)
			return { ok: false, message: error.message };
		throw error;
	}
	return { ok: true, value };
}

class FilterError extends Error {}
