import type {
	SyncExpenseDto,
	SyncRecurringTemplateDto,
} from "@retrospend/api-contract/sync";
import type { DeviceApi, FigureBasis } from "./ports";

// A server double for the device engine's tests (not a test itself): the sync
// routes answer pages the test queues, and every other route answers an empty
// page ending at "<route>-0". Each request is logged as `route(since)`.

/** A sync cursor, {e, t, s} as base64url JSON, the way the server writes it. */
export const cursor = (t: string, e = "e1") => {
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
	const bytes = [...JSON.stringify({ e, t, s: "9" })].map((c) =>
		c.charCodeAt(0),
	);
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const [x = 0, y, z] = [bytes[i], bytes[i + 1], bytes[i + 2]];
		const n = (x << 16) | ((y ?? 0) << 8) | (z ?? 0);
		out += alphabet[(n >> 18) & 63];
		out += alphabet[(n >> 12) & 63];
		if (y !== undefined) out += alphabet[(n >> 6) & 63];
		if (z !== undefined) out += alphabet[n & 63];
	}
	return out;
};

export const SETTINGS = {
	homeCurrency: "ARS",
	timeZone: "America/Argentina/Buenos_Aires",
	startDay: 1,
	hiddenProjectIds: [],
	defaultRateTypes: {},
};

export const OWED = {
	owedToYou: { minor: 0, currency: "ARS" },
	youOwe: { minor: 0, currency: "ARS" },
};

/** Typed as the contract's item, so a field the wire gains and the fake lacks fails typecheck. */
export const expense = (
	id: string,
	amount: string,
	date: string,
): SyncExpenseDto => ({
	id,
	title: "row",
	amount,
	currency: "ARS",
	date,
	categoryId: null,
	amountInUSD: "1",
	exchangeRate: "1500",
	pricingSource: "MANUAL",
	location: null,
	description: null,
	status: "FINALIZED",
	isAmortizedParent: false,
	isAmortizedChild: false,
	parentId: null,
	amortizeMode: "INSTALLMENTS",
	keepInWealth: false,
	recurringTemplateId: null,
	budgetEnvelopeId: null,
	excludeFromAnalytics: false,
	direction: "OUT",
	entryKind: "STANDARD",
	inType: null,
	rateType: "blue",
	homeCurrency: "ARS",
	homeRate: "1",
	homeAmount: amount,
	createdAt: date,
	updatedAt: date,
	movedInAt: null,
	planBatchId: null,
	importFingerprint: null,
});

/** Typed as the contract's item, like `expense`. */
export const template = (
	id: string,
	over: Partial<SyncRecurringTemplateDto> = {},
): SyncRecurringTemplateDto => ({
	id,
	name: "Rent",
	amount: "20",
	currency: "USD",
	categoryId: null,
	direction: "OUT",
	amountMode: "FIXED",
	frequency: "MONTHLY",
	nextDueDate: "2026-12-01T03:00:00.000Z",
	anchorDay: 1,
	websiteUrl: null,
	paymentSource: null,
	autoPay: true,
	isActive: true,
	createdAt: "2026-11-01T00:00:00.000Z",
	updatedAt: "2026-11-18T10:00:00.000Z",
	...over,
});

export interface Page {
	items: unknown[];
	tombstones: { id: string }[];
	cursor: string;
	hasMore: boolean;
}

export interface DeviceApiOptions {
	/** The expenses route's answer in each pull, by pull number from 1; the last one repeats. */
	expenses?: Page[];
	/**
	 * The expenses route as pages of one list: a request with no cursor gets the
	 * first page, one with a page's cursor gets the page after it, and every page
	 * but the last says there is more. Used instead of `expenses`.
	 */
	expensePages?: { items: unknown[]; cursor: string }[];
	/** The categories route's answer in each pull, as `expenses`. */
	categories?: Page[];
	/** The transfers route's answer in each pull, as `expenses`. */
	transfers?: Page[];
	/** The recurring templates route's answer in each pull, as `expenses`. */
	templates?: Page[];
	/** The settings the server holds (default: SETTINGS). */
	settings?: typeof SETTINGS;
	/** The daily rate table the server holds (default: empty). */
	rates?: {
		asOf: string | null;
		rates: {
			id: string;
			currency: string;
			type: string;
			date: string;
			unitsPerUsd: string;
		}[];
	};
	/** What GET /figures answers: id to lines. */
	figures?: Record<string, { minor: number; currency: string }[] | null>;
	/** The `basis` GET /figures answers with (a sync-capable session); none by default. */
	basis?: FigureBasis;
	/** An error GET /figures throws instead of answering. */
	figuresError?: unknown;
	/** A pull in which this route throws, by pull number from 1. */
	fail?: { route: string; pull: number; error: unknown };
}

export function fakeDeviceApi(options: DeviceApiOptions = {}) {
	const calls: string[] = [];
	let pulls = 0;
	const empty = (name: string): Page => ({
		items: [],
		tombstones: [],
		cursor: `${name}-0`,
		hasMore: false,
	});
	const route = (name: string) => async (query: { since?: string }) => {
		calls.push(`${name}(${query.since ?? "-"})`);
		if (options.fail?.route === name && options.fail.pull === pulls)
			throw options.fail.error;
		if (name === "expenses" && options.expensePages) {
			const pages = options.expensePages;
			const at = query.since
				? pages.findIndex((p) => p.cursor === query.since) + 1
				: 0;
			const found = pages[at];
			return found
				? {
						items: found.items,
						tombstones: [],
						cursor: found.cursor,
						hasMore: at < pages.length - 1,
					}
				: empty(name);
		}
		const queued =
			name === "expenses"
				? options.expenses
				: name === "categories"
					? options.categories
					: name === "transfers"
						? options.transfers
						: name === "recurringTemplates"
							? options.templates
							: undefined;
		return queued
			? (queued[Math.min(pulls, queued.length) - 1] ?? empty(name))
			: empty(name);
	};
	const sync = new Proxy(
		{
			settings: async () => {
				pulls += 1;
				calls.push("settings");
				return options.settings ?? SETTINGS;
			},
			shares: async () => {
				calls.push("shares");
				return { items: [], owed: OWED };
			},
		} as Record<string, unknown>,
		{ get: (known, name: string) => known[name] ?? route(name) },
	);
	const api: DeviceApi = {
		sync: sync as unknown as DeviceApi["sync"],
		currencies: {
			dailyRates: async () => {
				calls.push("dailyRates");
				return options.rates ?? { asOf: null, rates: [] };
			},
		},
		figures: {
			read: async ({ ids }: { ids: string }) => {
				calls.push(`figures(${ids})`);
				if (options.figuresError) throw options.figuresError;
				return {
					...(options.basis ? { basis: options.basis } : {}),
					figures: ids.split(",").map((id) => ({
						id,
						lines: options.figures?.[id] ?? null,
					})),
				};
			},
		},
	};
	return { api, calls, pulls: () => pulls };
}
