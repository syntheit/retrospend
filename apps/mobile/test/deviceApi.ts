import type { RetrospendClient } from "@retrospend/api-client";

// A server double for the device engine's tests (not a test itself): the sync
// routes answer pages the test queues, and every other route answers an empty
// page ending at "<route>-0". Each request is logged as `route(since)`.

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

export const expense = (id: string, amount: string, date: string) => ({
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
	/** What GET /figures answers: id to lines. */
	figures?: Record<string, { minor: number; currency: string }[] | null>;
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
		const queued = options.expenses;
		return name === "expenses" && queued
			? (queued[Math.min(pulls, queued.length) - 1] ?? empty(name))
			: empty(name);
	};
	const sync = new Proxy(
		{
			settings: async () => {
				pulls += 1;
				calls.push("settings");
				return SETTINGS;
			},
			shares: async () => {
				calls.push("shares");
				return { items: [], owed: OWED };
			},
		} as Record<string, unknown>,
		{ get: (known, name: string) => known[name] ?? route(name) },
	);
	const api = {
		sync,
		currencies: {
			dailyRates: async () => {
				calls.push("dailyRates");
				return { asOf: null, rates: [] };
			},
		},
		figures: {
			read: async ({ ids }: { ids: string }) => {
				calls.push(`figures(${ids})`);
				return {
					figures: ids.split(",").map((id) => ({
						id,
						lines: options.figures?.[id] ?? null,
					})),
				};
			},
		},
	} as unknown as RetrospendClient;
	return { api, calls, pulls: () => pulls };
}
