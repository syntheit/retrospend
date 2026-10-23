/**
 * Figure audit (IMPLEMENTATION §7.4, SYNTHESIS-r5 §6): what a page shows must
 * be what the server's figures registry says, on every page that shows it.
 *
 * Tagging contract (S1/S4 render it, this reads it):
 *   data-figure="<id>"     registry id with its scope, e.g. "owed.net" or
 *                          "project.total:e2e_project_floripa". No commas.
 *   data-minor="<int>"     the signed value. Money: ISO minor units of
 *                          data-currency (centavos for ARS, even though ARS
 *                          shows whole pesos). Percent: hundredths of a
 *                          percent (12.5% is 1250). Count: the count.
 *   data-currency="<ISO>"  for money; otherwise data-unit="percent" | "count".
 *   The element's text is the formatted value (sign, symbol, digits).
 *   data-ui="v2"           on the root of every overhauled page. A v2 page
 *                          with no figures fails the audit, and each page's
 *                          required ids live in required-figures.ts.
 *
 * Figures endpoint (S3, not built yet; until then tests inject a fetcher):
 *   GET /api/v1/figures?ids=<id>,<id>   ids URL-encoded, comma-separated
 *   200 {
 *     "figures": [
 *       { "id": "owed.net", "unit": "money", "minor": "-4110000", "currency": "ARS" },
 *       { "id": "budget.usedPct", "unit": "percent", "minor": "4250" }
 *     ],
 *     "missing": ["unknown.id"]
 *   }
 *   `minor` is a decimal integer string so values past 2^53 survive JSON.
 *   Every requested id is in exactly one of the two lists.
 *
 * Checks:
 *   1. text: the rendered text reads back as data-minor, within what the
 *      display can show (SYNTHESIS-r5: whole ARS ±1, other money ±0.01,
 *      percent ±0.5, counts exact), with no shown sign against the value's;
 *   2. api: data-minor equals the endpoint's value exactly;
 *   3. cross-page: one id carries the same data-minor on every page.
 */
import { SMART_NO_DECIMAL_CURRENCIES } from "@retrospend/domain/currency-format";
import { currencyDecimals } from "@retrospend/domain/money";
import type { APIRequestContext, Page } from "@playwright/test";
import { parseShownNumber, shownToUnits } from "./numbers";
import { requiredFiguresFor } from "./required-figures";

export type FigureUnit = "money" | "percent" | "count";

export interface FigureValue {
	id: string;
	unit: FigureUnit;
	minor: bigint;
	currency?: string;
}

export interface ApiFigure {
	id: string;
	unit: FigureUnit;
	minor: string | number;
	currency?: string;
}

export interface FiguresResponse {
	figures: ApiFigure[];
	missing?: string[];
}

export type FigureFetcher = (ids: string[]) => Promise<FiguresResponse>;

/** One tagged element as the page renders it, before validation. */
export interface FigureTag {
	id: string | null;
	minor: string | null;
	currency: string | null;
	unit: string | null;
	text: string;
}

/** What a page rendered: its tags, its locale and whether it is a v2 page. */
export interface PageFigures {
	tags: FigureTag[];
	locale: string;
	v2: boolean;
}

interface SeenFigure extends FigureValue {
	page: string;
}

/** How far displayed text may sit from data-minor, in the figure's own units. */
export function toleranceFor(unit: FigureUnit, currency?: string): bigint {
	if (unit === "count") return 0n;
	if (unit === "percent") return 50n;
	const code = (currency ?? "").toUpperCase();
	const decimals = currencyDecimals(code);
	if (SMART_NO_DECIMAL_CURRENCIES.includes(code))
		return 10n ** BigInt(decimals);
	return decimals > 2 ? 10n ** BigInt(decimals - 2) : 1n;
}

function decimalsFor(value: Pick<FigureValue, "unit" | "currency">): number {
	if (value.unit === "money") return currencyDecimals(value.currency ?? "");
	return value.unit === "percent" ? 2 : 0;
}

const abs = (n: bigint) => (n < 0n ? -n : n);
const show = (v: FigureValue) =>
	`${v.minor}${v.unit === "money" ? ` ${v.currency}` : ` (${v.unit})`}`;

/** Two readings of one figure must be identical; null when they are. */
export function compareValues(
	expected: FigureValue,
	actual: FigureValue,
): string | null {
	if (expected.unit !== actual.unit) {
		return `unit ${actual.unit} vs ${expected.unit}`;
	}
	if (expected.unit === "money" && expected.currency !== actual.currency) {
		return `currency ${actual.currency} vs ${expected.currency}`;
	}
	if (expected.minor !== actual.minor) {
		return `${show(actual)} vs ${show(expected)}`;
	}
	return null;
}

/** Validates a raw tag. Returns the figure, or the problem with it. */
export function readTag(tag: FigureTag): FigureValue | string {
	if (!tag.id || tag.id.includes(",")) return `bad data-figure "${tag.id}"`;
	if (!tag.minor || !/^-?\d+$/.test(tag.minor)) {
		return `${tag.id}: data-minor "${tag.minor}" is not an integer`;
	}
	const minor = BigInt(tag.minor);
	if (tag.currency) {
		if (!/^[A-Z0-9]{2,10}$/.test(tag.currency)) {
			return `${tag.id}: bad data-currency "${tag.currency}"`;
		}
		return { id: tag.id, unit: "money", minor, currency: tag.currency };
	}
	if (tag.unit === "percent" || tag.unit === "count") {
		return { id: tag.id, unit: tag.unit, minor };
	}
	return `${tag.id}: needs data-currency or data-unit="percent|count"`;
}

/** Does the text read back as the tagged value? Null when it does. */
export function checkText(
	value: FigureValue,
	text: string,
	locale: string,
): string | null {
	const shown = parseShownNumber(text, locale);
	if (!shown) return `${value.id}: no number in "${text}"`;
	if (shown.sign === "-" && value.minor > 0n) {
		return `${value.id}: shows "${text}" but the value is positive`;
	}
	if (shown.sign === "+" && value.minor < 0n) {
		return `${value.id}: shows "${text}" but the value is negative`;
	}
	const { units, step } = shownToUnits(shown, decimalsFor(value));
	// A rounded or compact display ("ARS 1.235", "1.2M") is exact to half its last digit.
	const base = toleranceFor(value.unit, value.currency);
	const tolerance = step / 2n > base ? step / 2n : base;
	if (abs(abs(value.minor) - units) > tolerance) {
		return `${value.id}: shows "${text}" (${units}) but data-minor is ${value.minor}`;
	}
	return null;
}

function fromApi(f: ApiFigure): FigureValue | string {
	if (!/^-?\d+$/.test(String(f.minor))) {
		return `the API sent minor "${f.minor}", not an integer`;
	}
	return {
		id: f.id,
		unit: f.unit,
		minor: BigInt(f.minor),
		currency: f.currency,
	};
}

/** Problems a page has before any value is compared: bad tags, missing ids. */
function pageShapeProblems(
	rendered: PageFigures,
	required: readonly string[],
	values: FigureValue[],
): string[] {
	const problems: string[] = [];
	if (rendered.v2 && rendered.tags.length === 0) {
		problems.push("is a v2 page but renders no figures");
	}
	const shown = new Set(values.map((v) => v.id));
	for (const id of required) {
		if (!shown.has(id))
			problems.push(`required figure ${id} is not on the page`);
	}
	return problems;
}

/**
 * Collects tags page by page, checks each page against the API, and
 * remembers every value for the cross-page check.
 */
export class FigureAudit {
	private readonly seen: SeenFigure[] = [];

	constructor(private readonly fetchFigures: FigureFetcher) {}

	/** Problems on one page. Records values for crossPage(). */
	async checkRendered(
		page: string,
		rendered: PageFigures,
		required: readonly string[] = [],
	): Promise<string[]> {
		const problems: string[] = [];
		const values: FigureValue[] = [];
		for (const tag of rendered.tags) {
			const value = readTag(tag);
			if (typeof value === "string") {
				problems.push(value);
				continue;
			}
			const textProblem = checkText(value, tag.text, rendered.locale);
			if (textProblem) problems.push(textProblem);
			values.push(value);
			this.seen.push({ ...value, page });
		}
		problems.push(...pageShapeProblems(rendered, required, values));
		if (values.length > 0) problems.push(...(await this.apiProblems(values)));
		return problems.map((p) => `${page}: ${p}`);
	}

	private async apiProblems(values: FigureValue[]): Promise<string[]> {
		const ids = [...new Set(values.map((v) => v.id))];
		const response = await this.fetchFigures(ids);
		const byId = new Map(response.figures.map((f) => [f.id, fromApi(f)]));
		const missing = new Set(response.missing ?? []);
		const problems: string[] = [];
		for (const value of values) {
			const api = byId.get(value.id);
			if (!api) {
				problems.push(
					missing.has(value.id)
						? `${value.id}: the figures API reports it missing`
						: `${value.id}: the figures API neither served nor listed it as missing`,
				);
				continue;
			}
			const mismatch =
				typeof api === "string" ? api : compareValues(api, value);
			if (mismatch) problems.push(`${value.id} screen vs API: ${mismatch}`);
		}
		return problems;
	}

	/**
	 * Collects the page's tags in the browser and checks them. `label` names
	 * the page in messages; `pageKey` picks its required ids.
	 */
	async checkPage(
		page: Page,
		label: string,
		pageKey = label,
	): Promise<string[]> {
		return this.checkRendered(
			label,
			await collectFigureTags(page),
			requiredFiguresFor(pageKey),
		);
	}

	/** Every id seen on more than one page (or twice on one) must be identical. */
	crossPage(): string[] {
		const problems: string[] = [];
		const first = new Map<string, SeenFigure>();
		for (const value of this.seen) {
			const earlier = first.get(value.id);
			if (!earlier) {
				first.set(value.id, value);
				continue;
			}
			const mismatch = compareValues(earlier, value);
			if (mismatch) {
				problems.push(
					`${value.id}: ${value.page} vs ${earlier.page}: ${mismatch}`,
				);
			}
		}
		return problems;
	}

	get figureCount(): number {
		return this.seen.length;
	}
}

/** Every [data-figure] on the page, the page's locale (html lang) and its v2 mark. */
export async function collectFigureTags(page: Page): Promise<PageFigures> {
	return page.evaluate(() => ({
		locale: document.documentElement.lang || "en-US",
		v2: document.querySelector('[data-ui="v2"]') !== null,
		tags: [...document.querySelectorAll<HTMLElement>("[data-figure]")].map(
			(el) => ({
				id: el.dataset.figure ?? null,
				minor: el.dataset.minor ?? null,
				currency: el.dataset.currency ?? null,
				unit: el.dataset.unit ?? null,
				text: (el.innerText || el.textContent || "").trim(),
			}),
		),
	}));
}

/** Fetcher for the real endpoint (S3), authenticated by the page's cookies. */
export function httpFigureFetcher(request: APIRequestContext): FigureFetcher {
	return async (ids) => {
		const query = ids.map(encodeURIComponent).join(",");
		const response = await request.get(`/api/v1/figures?ids=${query}`);
		if (!response.ok()) {
			throw new Error(
				`GET /api/v1/figures answered ${response.status()}: the page tags figures, so the endpoint must exist`,
			);
		}
		return fromV1((await response.json()) as V1Figures);
	};
}

/** What GET /api/v1/figures answers: every id with its per-currency lines, or null. */
interface V1Figures {
	figures: {
		id: string;
		lines: { minor: number; currency: string }[] | null;
	}[];
}

/**
 * The v1 answer as the audit reads it. A tag carries one currency, so only
 * a figure with exactly one line compares; none, several (a balance in two
 * currencies) or null (a missing rate) count as missing for the audit.
 */
export function fromV1(body: V1Figures): FiguresResponse {
	const figures: ApiFigure[] = [];
	const missing: string[] = [];
	for (const f of body.figures) {
		const [line] = f.lines ?? [];
		if (f.lines?.length === 1 && line)
			figures.push({
				id: f.id,
				unit: "money",
				minor: line.minor,
				currency: line.currency,
			});
		else missing.push(f.id);
	}
	return { figures, missing };
}
