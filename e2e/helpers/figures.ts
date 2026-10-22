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
 *
 * Checks, all with the SYNTHESIS-r5 tolerances (whole ARS ±1, other money
 * ±0.01, percent ±0.5, counts exact) and opposite signs always failing:
 *   1. text: the rendered text reads back as data-minor;
 *   2. api: data-minor equals the endpoint's value;
 *   3. cross-page: one id shows the same value on every page that shows it.
 */
import { currencyDecimals } from "@retrospend/domain/money";
import { SMART_NO_DECIMAL_CURRENCIES } from "@retrospend/domain/currency-format";
import type { APIRequestContext, Page } from "@playwright/test";
import { parseShownNumber, shownToUnits } from "./numbers";

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

interface SeenFigure extends FigureValue {
	page: string;
}

/** Allowed difference in the figure's own units (minor units, hundredths of a percent). */
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
const oppositeSigns = (a: bigint, b: bigint) =>
	(a > 0n && b < 0n) || (a < 0n && b > 0n);
const show = (v: FigureValue) =>
	`${v.minor}${v.unit === "money" ? ` ${v.currency}` : ` (${v.unit})`}`;

/** Compares two readings of one figure; null when they agree. */
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
	if (oppositeSigns(expected.minor, actual.minor)) {
		return `sign flipped: ${show(actual)} vs ${show(expected)}`;
	}
	const tolerance = toleranceFor(expected.unit, expected.currency);
	if (abs(expected.minor - actual.minor) > tolerance) {
		return `${show(actual)} vs ${show(expected)} (tolerance ${tolerance})`;
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

/**
 * Collects tags page by page, checks each page against the API, and
 * remembers every value for the cross-page check.
 */
export class FigureAudit {
	private readonly seen: SeenFigure[] = [];

	constructor(private readonly fetchFigures: FigureFetcher) {}

	/** Problems on one page (text and API checks). Records values for crossPage(). */
	async checkTags(
		page: string,
		tags: FigureTag[],
		locale: string,
	): Promise<string[]> {
		const problems: string[] = [];
		const values: FigureValue[] = [];
		for (const tag of tags) {
			const value = readTag(tag);
			if (typeof value === "string") {
				problems.push(`${page}: ${value}`);
				continue;
			}
			const textProblem = checkText(value, tag.text, locale);
			if (textProblem) problems.push(`${page}: ${textProblem}`);
			values.push(value);
			this.seen.push({ ...value, page });
		}
		if (values.length === 0) return problems;

		const ids = [...new Set(values.map((v) => v.id))];
		const response = await this.fetchFigures(ids);
		const byId = new Map(response.figures.map((f) => [f.id, fromApi(f)]));
		for (const value of values) {
			const api = byId.get(value.id);
			if (!api) {
				problems.push(`${page}: ${value.id} is not served by the figures API`);
				continue;
			}
			const mismatch =
				typeof api === "string" ? api : compareValues(api, value);
			if (mismatch)
				problems.push(`${page}: ${value.id} screen vs API: ${mismatch}`);
		}
		return problems;
	}

	/** Collects the page's tags in the browser and checks them. */
	async checkPage(page: Page, label: string): Promise<string[]> {
		const { tags, locale } = await collectFigureTags(page);
		return this.checkTags(label, tags, locale);
	}

	/** Every id seen on more than one page (or twice on one) must agree. */
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

/** Every [data-figure] on the page, plus the page's locale (html lang). */
export async function collectFigureTags(
	page: Page,
): Promise<{ tags: FigureTag[]; locale: string }> {
	return page.evaluate(() => ({
		locale: document.documentElement.lang || "en-US",
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
		return (await response.json()) as FiguresResponse;
	};
}
