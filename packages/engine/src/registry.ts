/**
 * The device's figure registry (E2EE P13): the figures a device reads from its
 * own rows, through the same registry core, the same loaders-from-rows and the
 * same domain compute the server calls, so a number is never made two ways.
 * `src/server/figures/device-registry.pg.test.ts` holds each of these to the
 * server's reading on the same data.
 *
 * Every figure reads only through the `Reader` it is given, never the store,
 * so a preview that passes its transaction sees the mutation's uncommitted
 * rows. A missing rate reads unavailable (a null reading naming the
 * currencies), exactly as on the server; a missing settings row throws, since
 * a signed-in user always has one and a silent USD would show wrong figures.
 *
 * What is not here, and why, is `serverOnlyReason`.
 */
import {
	accountBalancesFrom,
	accountsLedgerFromRows,
	CHANGE_PARTS,
	netWorthChangeFrom,
	netWorthFrom,
	netWorthInputsFromRows,
	notTrackedFrom,
	notTrackedUnitsOf,
	type OwedReading,
} from "@retrospend/domain/accounts/account-figures";
import { FigureNarrowingError } from "@retrospend/domain/figures/narrowing";
import {
	createFiguresRegistry,
	type FigureDefinition,
	type FigurePass,
	type FiguresRegistry,
} from "@retrospend/domain/figures/registry";
import { FigureUnavailable } from "@retrospend/domain/figures/unavailable";
import {
	type RateRow,
	rateLookup,
	rateRowsByCurrency,
	type StoredRateRow,
} from "@retrospend/domain/money";
import {
	type RecurringDirection,
	type RecurringPeriod,
	recurringAmountOf,
	recurringBodyFrom,
	recurringCostOf,
	recurringInputsFromRows,
	recurringRateCurrencies,
} from "@retrospend/domain/recurring-view";
import {
	lastToDate,
	type SpendPace,
	spendPaceFrom,
	spendPaceInputsFromRows,
} from "@retrospend/domain/spend-pace";
import {
	shareRateOf,
	spentInputsFromRows,
	spentMinorByCurrency,
	spentRange,
} from "@retrospend/domain/spent";
import { NotFoundError } from "./errors";
import {
	OWED_ID,
	type Reader,
	type SettingsRow,
	type TableName,
	type TableRows,
} from "./port";
import { settingsReads } from "./reference";

export interface DeviceFiguresDeps {
	/**
	 * The time every figure reads at, called once per read pass and never
	 * captured at construction, so a long-lived registry never goes stale.
	 */
	readonly clock?: () => Date;
}

type DeviceFigure = FigureDefinition<Reader>;

/**
 * What one read pass has loaded from its reader, so a pass over many figures
 * lists each table once instead of once per figure. A pass is one reader's
 * reads with no write between (the FigurePass contract), so what it loaded
 * cannot go stale; a pass handed to a different reader gets no memo.
 */
interface PassReads {
	readonly db: Reader;
	readonly tables: Map<TableName, readonly unknown[]>;
	settings?: SettingsRow;
	/** The rate rows of every currency, grouped once. */
	rateRows?: Record<string, RateRow[]>;
	notTracked?: ReturnType<typeof notTrackedUnitsOf>;
}

const passReads = new WeakMap<FigurePass, PassReads>();

function readsOf(db: Reader, pass?: FigurePass): PassReads | undefined {
	if (!pass) return undefined;
	let reads = passReads.get(pass);
	if (!reads) {
		reads = { db, tables: new Map() };
		passReads.set(pass, reads);
	}
	return reads.db === db ? reads : undefined;
}

/** The rows of `table`, listed once per pass; a plain list when there is no pass. */
function rowsIn<T extends TableName>(
	db: Reader,
	pass: FigurePass | undefined,
	table: T,
): readonly TableRows[T][] {
	const reads = readsOf(db, pass);
	if (!reads) return db.list(table);
	let rows = reads.tables.get(table);
	if (rows === undefined) {
		rows = db.list(table);
		reads.tables.set(table, rows);
	}
	return rows as readonly TableRows[T][];
}

/** The settings row; a store without one throws (NotFoundError), never a USD fallback. */
function settingsOf(db: Reader, pass?: FigurePass): SettingsRow {
	const reads = readsOf(db, pass);
	if (reads?.settings) return reads.settings;
	const row = settingsReads(db).require();
	if (reads) reads.settings = row;
	return row;
}

/** The not-tracked units of the pass's legs, summed once. */
function notTrackedIn(db: Reader, pass?: FigurePass) {
	const reads = readsOf(db, pass);
	if (reads?.notTracked) return reads.notTracked;
	const units = notTrackedUnitsOf(rowsIn(db, pass, "legs"));
	if (reads) reads.notTracked = units;
	return units;
}

/**
 * Owed to you and You owe from the `owed` row a shares sync wrote. Shared
 * money stays server-computed (the spike, 43-45), so the device reads the
 * server's totals from its store: constant within a pass, never changed by a
 * device write. No row (shares never pulled), or totals in another currency
 * than the home currency (settings changed since the pull), throws instead of
 * guessing: a missing total is never 0, and a stale one would be wrong.
 */
function owedOf(db: Reader, home: string): OwedReading {
	const row = db.get("owed", OWED_ID);
	if (!row) throw new NotFoundError("owed does not exist");
	if ("missingRates" in row) return { missingRates: row.missingRates };
	if (row.currency !== home)
		throw new NotFoundError(
			`owed is in ${row.currency}, not the home currency ${home}`,
		);
	return { owedToYou: row.owedToYou, youOwe: row.youOwe };
}

/**
 * The rate rows of `currencies` (USD has none), as rateRowsByCurrency gives
 * them. With a pass the rows are grouped once for every currency and each call
 * takes its currencies from that, so a currency not asked for is still absent.
 */
function ratesOf(
	db: Reader,
	pass: FigurePass | undefined,
	currencies: Iterable<string>,
): Record<string, RateRow[]> {
	const rates: readonly StoredRateRow[] = rowsIn(db, pass, "rates");
	const reads = readsOf(db, pass);
	if (!reads) return rateRowsByCurrency(rates, currencies);
	reads.rateRows ??= rateRowsByCurrency(
		rates,
		rates.map((r) => r.currency),
	);
	const picked: Record<string, RateRow[]> = {};
	for (const currency of currencies) {
		const rows = reads.rateRows[currency];
		if (rows) picked[currency] = rows;
	}
	return picked;
}

/** Rate lookups over the rows of `currencies`, picked in memory as the server's batch lookup does. */
function lookupFor(
	db: Reader,
	pass: FigurePass | undefined,
	currencies: Iterable<string>,
) {
	return rateLookup(ratesOf(db, pass, currencies));
}

/** The instant one pass reads at: the same for every figure of the pass. */
function readNow(clock: () => Date, pass?: FigurePass): Promise<Date> {
	const read = async () => new Date(clock().getTime());
	return pass ? pass.once("device:now", read) : read();
}

/** A once-per-pass load, or a plain one when there is no pass. */
function once<T>(
	pass: FigurePass | undefined,
	key: string,
	load: () => Promise<T>,
): Promise<T> {
	return pass ? pass.once(key, load) : load();
}

function spentFigure(clock: () => Date): DeviceFigure {
	return {
		id: "spent",
		scope: [],
		compute: async (db, _scope, pass) => {
			const s = settingsOf(db, pass);
			const range = spentRange(
				await readNow(clock, pass),
				s.startDay,
				s.timeZone,
			);
			return spentMinorByCurrency(
				spentInputsFromRows({
					expenses: rowsIn(db, pass, "expenses"),
					shares: rowsIn(db, pass, "shares"),
					hiddenProjectIds: s.hiddenProjectIds,
					range,
				}),
			);
		},
	};
}

async function loadPace(
	db: Reader,
	now: Date,
	pass?: FigurePass,
): Promise<SpendPace> {
	const s = settingsOf(db, pass);
	const shares = rowsIn(db, pass, "shares");
	const homeRates = ratesOf(db, pass, [s.homeCurrency])[s.homeCurrency];
	const shareLookup = lookupFor(
		db,
		pass,
		shares.filter((x) => x.exchangeRate === null).map((x) => x.currency),
	);
	return spendPaceFrom({
		home: s.homeCurrency,
		startDay: s.startDay,
		now,
		timeZone: s.timeZone,
		inputs: spendPaceInputsFromRows({
			expenses: rowsIn(db, pass, "expenses"),
			shares,
			hiddenProjectIds: s.hiddenProjectIds,
			home: s.homeCurrency,
			homeRates: homeRates ?? [],
			now,
			startDay: s.startDay,
			timeZone: s.timeZone,
			rateFor: shareRateOf(shareLookup),
		}),
	});
}

function glanceFigures(clock: () => Date): DeviceFigure[] {
	const figure = (
		id: string,
		pick: (pace: SpendPace) => number | null,
	): DeviceFigure => ({
		id,
		scope: [],
		compute: async (db, scope, pass) => {
			const pace = await once(pass, `glance:pace:${scope.userId}`, async () =>
				loadPace(db, await readNow(clock, pass), pass),
			);
			const minor = pick(pace);
			if (minor === null) return new FigureUnavailable(pace.missingRates);
			return { minor, currency: pace.home };
		},
	});
	return [
		figure("glance.spent", (p) => p.thisTotal),
		figure("glance.spentLastToDate", lastToDate),
		figure("glance.spentLast", (p) => p.lastTotal),
		figure("glance.moneyIn", (p) => p.moneyIn),
	];
}

const DIRECTIONS: readonly RecurringDirection[] = ["out", "in"];
const PERIODS: readonly RecurringPeriod[] = ["month", "quarter", "year"];

function recurringFigures(clock: () => Date): DeviceFigure[] {
	/** Due dates step and days show in the one saved zone, as the server's figure read has no request zone. */
	const bodyOf = (db: Reader, scope: { userId: string }, pass?: FigurePass) =>
		once(pass, `recurring:${scope.userId}`, async () => {
			const s = settingsOf(db, pass);
			const now = await readNow(clock, pass);
			const templates = rowsIn(db, pass, "recurringTemplates");
			return recurringBodyFrom({
				inputs: recurringInputsFromRows({
					home: s.homeCurrency,
					templates,
					rateRows: ratesOf(
						db,
						pass,
						recurringRateCurrencies(s.homeCurrency, templates),
					),
					now,
				}),
				now,
				timeZone: s.timeZone,
				stepZone: s.timeZone,
			});
		});

	const amount: DeviceFigure = {
		id: "recurring.amount",
		scope: ["recurringId"],
		compute: async (db, scope, pass) => {
			if (!scope.recurringId)
				throw new FigureNarrowingError(
					"recurring.amount needs a recurringId narrowing",
				);
			return recurringAmountOf(
				await bodyOf(db, scope, pass),
				scope.recurringId,
			);
		},
	};
	const costs = DIRECTIONS.flatMap((dir) =>
		PERIODS.map(
			(period): DeviceFigure => ({
				id: `recurring.cost.${dir}.${period}`,
				scope: [],
				compute: async (db, scope, pass) => {
					const cost = recurringCostOf(
						await bodyOf(db, scope, pass),
						dir,
						period,
					);
					return Array.isArray(cost)
						? cost
						: new FigureUnavailable(cost.unavailable);
				},
			}),
		),
	);
	return [amount, ...costs];
}

function accountFigures(clock: () => Date): DeviceFigure[] {
	const netWorth: DeviceFigure = {
		id: "netWorth",
		scope: [],
		compute: async (db, _scope, pass) => {
			const s = settingsOf(db, pass);
			const open = rowsIn(db, pass, "accounts").filter(
				(a) => a.closedAt === null,
			);
			const legs = rowsIn(db, pass, "legs");
			const notTracked = notTrackedIn(db, pass);
			const pick = lookupFor(db, pass, [
				s.homeCurrency,
				...open.map((a) => a.currency),
				...notTracked.map((u) => u.currency),
			]);
			const net = netWorthFrom(
				netWorthInputsFromRows({
					home: s.homeCurrency,
					accounts: open,
					legs,
					pick,
					owed: owedOf(db, s.homeCurrency),
				}),
				await readNow(clock, pass),
			);
			return net.value ?? new FigureUnavailable(net.missingRates);
		},
	};

	const changeFigure = (part: (typeof CHANGE_PARTS)[number] | "total") =>
		({
			id: `netWorthChange.${part}`,
			scope: [],
			// The total and the seven parts are one breakdown: loaded once per read pass.
			compute: async (db, scope, pass) => {
				const change = await once(
					pass,
					`netWorthChange:${scope.userId}`,
					async () => {
						const s = settingsOf(db, pass);
						const accounts = rowsIn(db, pass, "accounts");
						const snapshots = rowsIn(db, pass, "snapshots");
						const legs = rowsIn(db, pass, "legs");
						const untracked = notTrackedIn(db, pass).map((u) => u.currency);
						const pick = lookupFor(db, pass, [
							s.homeCurrency,
							...accounts.map((a) => a.currency),
							...snapshots.flatMap((x) => (x.currency ? [x.currency] : [])),
							...untracked,
						]);
						return netWorthChangeFrom(
							accountsLedgerFromRows({
								home: s.homeCurrency,
								accounts,
								snapshots,
								legs,
								rateSwitches: rowsIn(db, pass, "rateSwitches"),
								pick,
							}),
							await readNow(clock, pass),
						);
					},
				);
				if (!change) return null;
				const minor = part === "total" ? change.total : change.parts[part];
				return { minor, currency: change.currency };
			},
		}) satisfies DeviceFigure;

	const balance: DeviceFigure = {
		id: "accounts.balance",
		scope: ["accountId"],
		compute: async (db, scope, pass) =>
			accountBalancesFrom(rowsIn(db, pass, "accounts"), scope.accountId),
	};
	const notTracked: DeviceFigure = {
		id: "notTracked",
		scope: [],
		compute: async (db, _scope, pass) =>
			notTrackedFrom(notTrackedIn(db, pass)),
	};
	return [
		netWorth,
		changeFigure("total"),
		...CHANGE_PARTS.map(changeFigure),
		balance,
		notTracked,
	];
}

/** The device's figures, 23 ids (`DEVICE_FIGURE_IDS`). */
export function deviceFigures(
	deps: DeviceFiguresDeps = {},
): FiguresRegistry<Reader> {
	const clock = deps.clock ?? (() => new Date());
	return createFiguresRegistry<Reader>([
		spentFigure(clock),
		...glanceFigures(clock),
		...recurringFigures(clock),
		...accountFigures(clock),
	]);
}

/** The ids `deviceFigures` registers. The pg conformance test holds this list to the registry. */
export const DEVICE_FIGURE_IDS: readonly string[] = [
	"spent",
	"glance.spent",
	"glance.spentLastToDate",
	"glance.spentLast",
	"glance.moneyIn",
	"recurring.amount",
	...DIRECTIONS.flatMap((dir) =>
		PERIODS.map((period) => `recurring.cost.${dir}.${period}`),
	),
	"netWorth",
	"netWorthChange.total",
	...CHANGE_PARTS.map((part) => `netWorthChange.${part}`),
	"accounts.balance",
	"notTracked",
];

/**
 * Why a server figure has no device twin yet, by id prefix. A figure the
 * server registers that is neither in DEVICE_FIGURE_IDS nor named here fails
 * the conformance test, so a new figure cannot skip the question.
 */
const SERVER_ONLY: readonly { prefix: string; reason: string }[] = [
	{
		prefix: "entry.",
		reason: "P13b: needs the activity tables the port lacks",
	},
	{
		prefix: "budget.",
		reason: "P13b: the envelope month view still reads Prisma only",
	},
	{
		prefix: "envelope.",
		reason: "P13b: the envelope month view still reads Prisma only",
	},
	{
		prefix: "insights.",
		reason: "P13b after E2EE P6: insights readers still take the server db",
	},
	{
		prefix: "rate.dollarToday",
		reason: "public data, read from the server",
	},
	{
		prefix: "balance.person",
		reason: "shared money is server-computed",
	},
	{ prefix: "owed.", reason: "shared money is server-computed" },
	{ prefix: "project.", reason: "shared money is server-computed" },
	{ prefix: "correction.", reason: "shared money is server-computed" },
];

/** The reason a server figure id is not on the device, or undefined when it is, or unknown. */
export function serverOnlyReason(id: string): string | undefined {
	return SERVER_ONLY.find((s) => id.startsWith(s.prefix))?.reason;
}
