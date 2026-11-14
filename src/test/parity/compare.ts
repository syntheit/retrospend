/**
 * Reading figures on both sides and holding them equal (E2EE P16). The server
 * side reads the real registry through a user transaction; the device side
 * reads the device registry from a store. `readAll` reads every device figure
 * id and its variants (each template and account, none, an unknown one) on
 * both sides, with the currencies that kept a figure out, so one call is the
 * whole parity check of a ledger. K9c (the mobile engine on the same ledger)
 * can reuse it with its own store.
 *
 * The root app does not depend on the engine package, so it is imported by
 * path, as the other conformance tests do.
 */
import {
	FigurePass,
	type FigureReading,
	readFiguresIn,
} from "@retrospend/domain/figures/registry";
import { expect } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { figures } from "~/server/figures/registry";
import {
	DEVICE_FIGURE_IDS,
	deviceFigures,
	type Reader,
} from "../../../packages/engine/src/index";
import { adminDb } from "../pg-harness";

export interface Read {
	readings: ReadonlyMap<string, FigureReading>;
	missing: ReadonlyMap<string, string[]>;
}

/** Reads `ids` from the server's registry, as `userId`, in one transaction with one pass. */
export async function serverRead(
	userId: string,
	ids: readonly string[],
	narrowing: Record<string, string> = {},
): Promise<Read> {
	return userTransaction(adminDb, userId, async (tx) => {
		const pass = new FigurePass();
		const readings = await readFiguresIn(
			tx,
			ids.map((id) => figures.get(id)),
			{ ...narrowing, userId },
			pass,
		);
		return {
			readings,
			missing: new Map(ids.map((id) => [id, pass.missingRates(id)])),
		};
	});
}

/**
 * Reads `ids` from the device registry over `store`, one pass. `clock` fixes
 * the instant the figures read at, so a timing run can use the real Date
 * instead of a faked one.
 */
export async function deviceReadFrom(
	store: Reader,
	userId: string,
	ids: readonly string[],
	narrowing: Record<string, string> = {},
	clock?: () => Date,
): Promise<Read> {
	const registry = deviceFigures({ clock });
	const pass = new FigurePass();
	const readings = await readFiguresIn(
		store,
		ids.map((id) => registry.get(id)),
		{ ...narrowing, userId },
		pass,
	);
	return {
		readings,
		missing: new Map(ids.map((id) => [id, pass.missingRates(id)])),
	};
}

/** Every id equal on both sides, with the id in the failure message. */
export function expectSame(device: Read, server: Read, ids: readonly string[]) {
	for (const id of ids) {
		expect(device.readings.get(id), `${id} reading`).toEqual(
			server.readings.get(id),
		);
		expect(device.missing.get(id), `${id} missing rates`).toEqual(
			server.missing.get(id),
		);
	}
}

/** The ids that need no narrowing, and `accounts.balance` read over every account. */
export const SCOPELESS_IDS = DEVICE_FIGURE_IDS.filter(
	(id) => id !== "recurring.amount" && id !== "accounts.balance",
);

/** The insights figures that narrow by a category. */
const CATEGORY_IDS = [
	"insights.byCategory",
	"insights.ytdByCategory",
	"insights.ytdByCategoryUsd",
];

/**
 * The fiscal months read by label: this one at the first clock (October 2026),
 * the ones holding December 31 and January 1 around the year-boundary clock,
 * and an empty one after the seeded span.
 */
export const INSIGHTS_MONTHS = ["2026-10", "2026-12", "2027-01", "2027-03"];

export interface LedgerRefs {
	userId: string;
	templateIds: readonly string[];
	accountIds: readonly string[];
	/** The user's expense categories, their INCOME one and another user's, for the insights category variants. */
	categoryIds?: readonly string[];
	incomeCategory?: string;
	bobCategory?: string;
}

export interface Readings {
	/** Keys are the figure id, plus `|recurringId=<id>`, `|accountId=<id>`, `|month=<label>` or `|categoryId=<id>` for a variant. */
	keys: string[];
	device: Read;
	server: Read;
}

/**
 * Every device figure id and every variant, read on both sides. Variants:
 * `recurring.amount` for each template and an unknown one, `accounts.balance`
 * for each account and an unknown one, `insights.byMonth` for each of
 * INSIGHTS_MONTHS, and the three insights category figures for each category
 * of the ledger, its INCOME category (reads 0), another user's (reads 0) and
 * an unknown one. Each variant is read in a pass of its own.
 */
export async function readAll(
	store: Reader,
	refs: LedgerRefs,
): Promise<Readings> {
	const { userId } = refs;
	const base = [...SCOPELESS_IDS, "accounts.balance"];
	const categories = [
		...(refs.categoryIds ?? []),
		...(refs.incomeCategory ? [refs.incomeCategory] : []),
		...(refs.bobCategory ? [refs.bobCategory] : []),
		"no-such-category",
	];
	const variants: { ids: string[]; key: string; value: string }[] = [
		...[...refs.templateIds, "no-such-template"].map((value) => ({
			ids: ["recurring.amount"],
			key: "recurringId",
			value,
		})),
		...[...refs.accountIds, "no-such-account"].map((value) => ({
			ids: ["accounts.balance"],
			key: "accountId",
			value,
		})),
		...INSIGHTS_MONTHS.map((value) => ({
			ids: ["insights.byMonth"],
			key: "month",
			value,
		})),
		...categories.map((value) => ({
			ids: CATEGORY_IDS,
			key: "categoryId",
			value,
		})),
	];
	const readings = new Map<"device" | "server", Map<string, FigureReading>>([
		["device", new Map()],
		["server", new Map()],
	]);
	const missing = new Map<"device" | "server", Map<string, string[]>>([
		["device", new Map()],
		["server", new Map()],
	]);
	const keys: string[] = [];
	const take = (
		side: "device" | "server",
		read: Read,
		ids: readonly string[],
		suffix: string,
	) => {
		for (const id of ids) {
			readings.get(side)?.set(`${id}${suffix}`, read.readings.get(id) ?? null);
			missing.get(side)?.set(`${id}${suffix}`, read.missing.get(id) ?? []);
		}
	};
	take("server", await serverRead(userId, base), base, "");
	take("device", await deviceReadFrom(store, userId, base), base, "");
	keys.push(...base);
	for (const v of variants) {
		const narrowing = { [v.key]: v.value };
		const suffix = `|${v.key}=${v.value}`;
		take("server", await serverRead(userId, v.ids, narrowing), v.ids, suffix);
		take(
			"device",
			await deviceReadFrom(store, userId, v.ids, narrowing),
			v.ids,
			suffix,
		);
		keys.push(...v.ids.map((id) => `${id}${suffix}`));
	}
	return {
		keys,
		device: {
			readings: readings.get("device") as Map<string, FigureReading>,
			missing: missing.get("device") as Map<string, string[]>,
		},
		server: {
			readings: readings.get("server") as Map<string, FigureReading>,
			missing: missing.get("server") as Map<string, string[]>,
		},
	};
}

/** readAll, with every key equal on both sides. */
export async function expectParity(
	store: Reader,
	refs: LedgerRefs,
): Promise<Readings> {
	const all = await readAll(store, refs);
	expectSame(all.device, all.server, all.keys);
	return all;
}
