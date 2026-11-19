/**
 * The pull side of the parity harness: a device's MemoryStore fed
 * by the engine's own pull driver (packages/engine/src/sync-pull.ts, the code
 * the app runs) through the real client over the handler the Next route uses,
 * as a mobile app session. So the JSON, the sync scope and row-level security
 * are the production ones. What stays here is test plumbing: the session, a
 * fresh address per request, the row counts a pull must end with, the deadline
 * for a change that is not visible yet, and the fake clock around the shares
 * pull. `engineStoreOf` (src/test/engine-store.ts) never feeds a device here;
 * it is only a cross-check.
 *
 * `apiOver` names every route the driver calls from the contract's client, so
 * a contract change that retypes a synced field fails to compile here (the
 * driver's wire shapes must accept the contract's DTOs).
 */
import { randomBytes } from "node:crypto";
import {
	createRetrospendClient,
	type RetrospendClient,
} from "@retrospend/api-client";
import {
	MemoryStore,
	type PullApi,
	type PullCursors,
	type PullReport,
	pullAll as pullAllWith,
	pullSettings as pullSettingsWith,
	pullShares as pullSharesWith,
	type StepReport,
	type SyncEntity,
} from "../../../packages/engine/src/index";
import {
	adminDb,
	sessionFor,
} from "../../server/api/v1/core/__tests__/harness";
import { handleV1Request } from "../../server/api/v1/handler";
import { soloBook } from "../../server/services/sync/book-entities";
import type { ParityLedger } from "./ledger";

export type EntityTiming = StepReport;
export type { PullReport };

/** A mobile app session that outlives any fake clock a test sets. */
export async function longSession(userId: string): Promise<string> {
	const token = await sessionFor(userId);
	await adminDb.session.update({
		where: { token },
		data: { expiresAt: new Date("2035-01-01T00:00:00Z") },
	});
	return token;
}

/** A fresh address per request, so no per-IP limit window is shared with another call or file. */
export const freshIp = () => {
	const [a = 0, b = 0, c = 0] = randomBytes(3);
	return { "x-real-ip": `10.${a}.${b}.${c}` };
};

/** A session takes 300 requests a minute (tokenRateLimit); this leaves room. */
const SESSION_REQUESTS = 80;

/**
 * The client the app uses, its requests answered by the route handler in
 * process. Its requests move to a new session every SESSION_REQUESTS: the
 * limiter counts per session in a window of the (fake) clock the request is
 * made at, so one session carried across a file's clocks, and a pull of
 * hundreds of requests, would meet a count it never reset.
 */
export function rotatingClient(userId: string): RetrospendClient {
	let token = "";
	let used = SESSION_REQUESTS;
	return createRetrospendClient({
		baseUrl: "http://localhost:3101",
		fetch: async (input, init) => {
			if (used >= SESSION_REQUESTS) {
				token = await longSession(userId);
				used = 0;
			}
			used += 1;
			const request = new Request(input, init);
			request.headers.set("authorization", `Bearer ${token}`);
			for (const [name, value] of Object.entries(freshIp()))
				request.headers.set(name, value);
			return handleV1Request(request);
		},
	});
}

/** Every route the driver calls, taken from the client. */
export function apiOver(
	client: RetrospendClient,
	shares: PullApi["sync"]["shares"],
): PullApi {
	const { sync } = client;
	return {
		sync: {
			settings: () => sync.settings(),
			shares,
			categories: (q) => sync.categories(q),
			recurringTemplates: (q) => sync.recurringTemplates(q),
			expenses: (q) => sync.expenses(q),
			accounts: (q) => sync.accounts(q),
			accountSnapshots: (q) => sync.accountSnapshots(q),
			accountLegs: (q) => sync.accountLegs(q),
			accountRateTypes: (q) => sync.accountRateTypes(q),
			budgetBooks: (q) => sync.budgetBooks(q),
			envelopeGroups: (q) => sync.envelopeGroups(q),
			envelopes: (q) => sync.envelopes(q),
			envelopeCategories: (q) => sync.envelopeCategories(q),
			budgetMovements: (q) => sync.budgetMovements(q),
			bookPeriods: (q) => sync.bookPeriods(q),
			monthCloses: (q) => sync.monthCloses(q),
			wealthTransfers: (q) => sync.wealthTransfers(q),
			payoffPlans: (q) => sync.payoffPlans(q),
			transfers: (q) => sync.transfers(q),
		},
		currencies: { dailyRates: () => client.currencies.dailyRates() },
	};
}

/**
 * The shares snapshot is read with a session of its own each time: a request
 * made under a future fake clock leaves a future rate-limit window on its
 * keys, which must not be one a later request shares. `atClock` runs it under
 * the clock a test sets (the owed totals and the block are priced at the
 * server's clock of that call).
 */
export function sharesOf(
	userId: string,
	atClock?: <T>(fn: () => Promise<T>) => Promise<T>,
): PullApi["sync"]["shares"] {
	return async (q) => {
		const own = rotatingClient(userId);
		const read = () => own.sync.shares(q);
		return atClock ? atClock(read) : read();
	};
}

export interface Device {
	userId: string;
	store: MemoryStore;
	api: PullApi;
	/** The cursor each cursor entity last returned, for the next delta pull. */
	cursors: PullCursors;
}

export async function newDevice(userId: string): Promise<Device> {
	return {
		userId,
		store: new MemoryStore(),
		api: apiOver(rotatingClient(userId), sharesOf(userId)),
		cursors: {},
	};
}

/** Row counts of the book family and the transfers: what the loop must end with for each. */
export interface BookCounts {
	budgetBooks: number;
	envelopeGroups: number;
	envelopes: number;
	envelopeCategories: number;
	budgetMovements: number;
	bookPeriods: number;
	monthCloses: number;
	wealthTransfers: number;
	payoffPlans: number;
	transfers: number;
}

export type PullCounts = ParityLedger["counts"] & BookCounts;

const COUNT_OF: Record<SyncEntity, keyof PullCounts> = {
	categories: "categories",
	recurringTemplates: "templates",
	expenses: "expenses",
	accounts: "accounts",
	snapshots: "snapshots",
	legs: "legs",
	rateSwitches: "rateSwitches",
	budgetBooks: "budgetBooks",
	envelopeGroups: "envelopeGroups",
	envelopes: "envelopes",
	envelopeCategories: "envelopeCategories",
	budgetMovements: "budgetMovements",
	bookPeriods: "bookPeriods",
	monthCloses: "monthCloses",
	wealthTransfers: "wealthTransfers",
	payoffPlans: "payoffPlans",
	transfers: "transfers",
};

/** What the database holds for `userId` in each cursor entity: the rows a pull must end with. */
export async function expectedCounts(userId: string): Promise<PullCounts> {
	const where = { userId };
	const [
		expenses,
		categories,
		templates,
		accounts,
		snapshots,
		legs,
		rateSwitches,
		shares,
	] = await Promise.all([
		adminDb.expense.count({ where }),
		adminDb.category.count({ where }),
		adminDb.recurringTemplate.count({ where }),
		adminDb.assetAccount.count({ where }),
		adminDb.assetSnapshot.count({ where }),
		adminDb.accountLeg.count({ where }),
		adminDb.assetRateType.count({ where }),
		adminDb.splitParticipant.count({
			where: { participantType: "user", participantId: userId },
		}),
	]);
	const book = await adminDb.budgetBook.findFirst({ where: soloBook(userId) });
	const inBook = { bookId: book?.id ?? "" };
	const [
		envelopeGroups,
		envelopes,
		envelopeCategories,
		budgetMovements,
		bookPeriods,
		monthCloses,
		wealthTransfers,
		payoffPlans,
		transfers,
	] = await Promise.all([
		adminDb.envelopeGroup.count({ where: inBook }),
		adminDb.envelope.count({ where: inBook }),
		adminDb.envelopeCategory.count({ where: inBook }),
		adminDb.budgetMovement.count({ where: inBook }),
		adminDb.bookPeriod.count({ where: inBook }),
		adminDb.monthClose.count({ where: inBook }),
		adminDb.wealthTransfer.count({ where: inBook }),
		adminDb.payoffPlan.count({ where: inBook }),
		adminDb.transfer.count({ where }),
	]);
	return {
		expenses,
		categories,
		templates,
		accounts,
		snapshots,
		legs,
		rateSwitches,
		shares,
		budgetBooks: book ? 1 : 0,
		envelopeGroups,
		envelopes,
		envelopeCategories,
		budgetMovements,
		bookPeriods,
		monthCloses,
		wealthTransfers,
		payoffPlans,
		transfers,
	};
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Timings on the real clock, which a faked Date never moves. */
const now = () => performance.now();

export const pullSettings = (device: Device) =>
	pullSettingsWith(device.store, device.api, { now });

export const pullShares = (device: Device) =>
	pullSharesWith(device.store, device.api, { now });

/**
 * Pulls everything a device needs with the engine's driver and returns its
 * report. `expected` are the row counts the database holds now: a change
 * shows up once every older write transaction on the server has finished, so
 * an entity with fewer rows than that is asked again from its cursor until the
 * count is reached or the deadline passes. `atClock` wraps the shares pull
 * only; `shares: false` leaves it and the budget block out.
 */
export async function pullAll(
	device: Device,
	expected: PullCounts,
	options: {
		deadlineMs?: number;
		shares?: boolean;
		atClock?: <T>(fn: () => Promise<T>) => Promise<T>;
	} = {},
): Promise<PullReport> {
	const deadline = performance.now() + (options.deadlineMs ?? 60_000);
	const api: PullApi = options.atClock
		? apiOver(
				rotatingClient(device.userId),
				sharesOf(device.userId, options.atClock),
			)
		: device.api;
	return pullAllWith(device.store, api, device.cursors, {
		now,
		shares: options.shares,
		caughtUp: async (entity, held) => {
			const want = expected[COUNT_OF[entity]];
			if (held === want) return true;
			if (performance.now() > deadline)
				throw new Error(
					`${entity}: the store holds ${held} rows, the database ${want}`,
				);
			await sleep(50);
			return false;
		},
	});
}
