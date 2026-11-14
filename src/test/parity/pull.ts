/**
 * The pull driver of the parity harness (E2EE P16): a device's MemoryStore
 * fed only from real v1 responses. Each page is a request through the handler
 * the Next route uses, as a mobile app session, so the JSON, the sync scope,
 * the output schema and row-level security are the production ones, and the
 * engine's apply layer (sync-apply.ts, the code the app's own pull loop will
 * run) puts the page in the store. `engineStoreOf` (src/test/engine-store.ts)
 * never feeds a device here; it is only a cross-check.
 *
 * Order, as a device would pull: settings, categories, templates, expenses,
 * accounts, snapshots, legs, rate types, the rate table, shares. A cursor
 * entity is paged at the largest page until it says it has no more and the
 * store holds as many rows as the database has for the user: a change shows
 * up once every older write transaction on the server has finished, so the
 * loop keeps asking (from the last cursor) until the count is reached or the
 * deadline passes. The deadline runs on performance.now(), which a faked Date
 * never moves.
 *
 * The apply functions take the engine's structural wire shapes; each spec's
 * `Dto extends WireOf[E]` is the compile-time check that the contract's DTO
 * is assignable to them, so a contract change that retypes a synced field
 * fails to compile here.
 */
import { randomBytes } from "node:crypto";
import {
	contract,
	type DailyRatesDto,
	type SyncAccountDto,
	type SyncAccountLegDto,
	type SyncAccountRateTypeDto,
	type SyncAccountSnapshotDto,
	type SyncCategoryDto,
	type SyncExpenseDto,
	type SyncRecurringTemplateDto,
	type SyncSettingsDto,
	type SyncSharesDto,
} from "@retrospend/api-contract";
import {
	applyDailyTable,
	applySettings,
	applySharesSnapshot,
	applySyncPage,
	MemoryStore,
	type SyncEntity,
	type TableName,
	type WireOf,
} from "../../../packages/engine/src/index";
import {
	adminDb,
	call,
	expectBody,
	sessionFor,
} from "../../server/api/v1/core/__tests__/harness";
import type { ParityLedger } from "./ledger";

/** A mobile app session that outlives any fake clock a test sets. */
async function longSession(userId: string): Promise<string> {
	const token = await sessionFor(userId);
	await adminDb.session.update({
		where: { token },
		data: { expiresAt: new Date("2035-01-01T00:00:00Z") },
	});
	return token;
}

/** A fresh address per request, so no per-IP limit window is shared with another call or file. */
const freshIp = () => {
	const [a = 0, b = 0, c = 0] = randomBytes(3);
	return { "x-real-ip": `10.${a}.${b}.${c}` };
};

export interface Device {
	userId: string;
	store: MemoryStore;
	headers: Record<string, string>;
	/** The cursor each cursor entity last returned, for the next delta pull. */
	cursors: Partial<Record<SyncEntity, string>>;
}

export async function newDevice(userId: string): Promise<Device> {
	return {
		userId,
		store: new MemoryStore(),
		headers: { authorization: `Bearer ${await longSession(userId)}` },
		cursors: {},
	};
}

const get = (device: Device, path: string, headers = device.headers) =>
	call(path, { headers: { ...freshIp(), ...headers } });

export interface EntityTiming {
	fetchMs: number;
	applyMs: number;
	pages: number;
	rows: number;
}

type PageDto<Dto> = {
	items: Dto[];
	tombstones: { id: string; deletedAt: string }[];
	cursor: string;
	hasMore: boolean;
};

interface Route {
	"~orpc": { outputSchema?: unknown };
}

/** One cursor entity: its table and a runner with the DTO type fixed. */
interface Spec {
	entity: SyncEntity;
	run(
		device: Device,
		expected: number,
		deadline: number,
	): Promise<EntityTiming>;
}

/** `Dto extends WireOf[E]` is the check that the contract's row is what the engine applies. */
const spec = <E extends SyncEntity, Dto extends WireOf[E]>(
	entity: E,
	path: string,
	route: Route,
): Spec => ({
	entity,
	run: (device, expected, deadline) =>
		pullEntity<E, Dto>(device, entity, path, route, expected, deadline),
});

/** In the order a device pulls them. */
const SPECS = [
	spec<"categories", SyncCategoryDto>(
		"categories",
		"/sync/categories",
		contract.sync.categories,
	),
	spec<"recurringTemplates", SyncRecurringTemplateDto>(
		"recurringTemplates",
		"/sync/recurring-templates",
		contract.sync.recurringTemplates,
	),
	spec<"expenses", SyncExpenseDto>(
		"expenses",
		"/sync/expenses",
		contract.sync.expenses,
	),
	spec<"accounts", SyncAccountDto>(
		"accounts",
		"/sync/accounts",
		contract.sync.accounts,
	),
	spec<"snapshots", SyncAccountSnapshotDto>(
		"snapshots",
		"/sync/account-snapshots",
		contract.sync.accountSnapshots,
	),
	spec<"legs", SyncAccountLegDto>(
		"legs",
		"/sync/account-legs",
		contract.sync.accountLegs,
	),
	spec<"rateSwitches", SyncAccountRateTypeDto>(
		"rateSwitches",
		"/sync/account-rate-types",
		contract.sync.accountRateTypes,
	),
] as const;

const COUNT_OF: Record<SyncEntity, keyof ParityLedger["counts"]> = {
	categories: "categories",
	recurringTemplates: "templates",
	expenses: "expenses",
	accounts: "accounts",
	snapshots: "snapshots",
	legs: "legs",
	rateSwitches: "rateSwitches",
};

/** What the database holds for `userId` in each cursor entity: the rows a pull must end with. */
export async function expectedCounts(
	userId: string,
): Promise<ParityLedger["counts"]> {
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
	return {
		expenses,
		categories,
		templates,
		accounts,
		snapshots,
		legs,
		rateSwitches,
		shares,
	};
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const TABLE_OF: Record<SyncEntity, TableName> = {
	categories: "categories",
	recurringTemplates: "recurringTemplates",
	expenses: "expenses",
	accounts: "accounts",
	snapshots: "snapshots",
	legs: "legs",
	rateSwitches: "rateSwitches",
};

async function pullEntity<E extends SyncEntity, Dto extends WireOf[E]>(
	device: Device,
	entity: E,
	path: string,
	route: Route,
	expected: number,
	deadline: number,
): Promise<EntityTiming> {
	const timing: EntityTiming = { fetchMs: 0, applyMs: 0, pages: 0, rows: 0 };
	for (;;) {
		const since = device.cursors[entity];
		const started = performance.now();
		const page = await expectBody<PageDto<Dto>>(
			await get(
				device,
				`${path}?limit=500${since ? `&since=${encodeURIComponent(since)}` : ""}`,
			),
			route,
		);
		const fetched = performance.now();
		await device.store.transaction((tx) => applySyncPage(tx, entity, page));
		timing.fetchMs += fetched - started;
		timing.applyMs += performance.now() - fetched;
		timing.pages += 1;
		timing.rows += page.items.length + page.tombstones.length;
		device.cursors[entity] = page.cursor;
		if (!page.hasMore) {
			const held = device.store.list(TABLE_OF[entity]).length;
			if (held === expected) return timing;
			if (performance.now() > deadline)
				throw new Error(
					`${entity}: the store holds ${held} rows, the database ${expected}`,
				);
			// A change not yet visible: ask again from the cursor.
			await sleep(50);
		}
	}
}

export interface PullReport {
	entities: Partial<
		Record<SyncEntity | "settings" | "rates" | "shares", EntityTiming>
	>;
	totalMs: number;
}

const single = (): EntityTiming => ({
	fetchMs: 0,
	applyMs: 0,
	pages: 1,
	rows: 1,
});

/** GET /sync/settings into the settings row. */
export async function pullSettings(device: Device): Promise<EntityTiming> {
	const started = performance.now();
	const body = await expectBody<SyncSettingsDto>(
		await get(device, "/sync/settings"),
		contract.sync.settings,
	);
	const fetched = performance.now();
	await device.store.transaction((tx) => applySettings(tx, body));
	return {
		...single(),
		fetchMs: fetched - started,
		applyMs: performance.now() - fetched,
	};
}

/** GET /rates/daily into the rate table. */
export async function pullRates(device: Device): Promise<EntityTiming> {
	const started = performance.now();
	const body = await expectBody<DailyRatesDto>(
		await get(device, "/rates/daily"),
		contract.currencies.dailyRates,
	);
	const fetched = performance.now();
	await device.store.transaction((tx) => applyDailyTable(tx, body));
	return {
		fetchMs: fetched - started,
		applyMs: performance.now() - fetched,
		pages: 1,
		rows: body.rates.length,
	};
}

/**
 * GET /sync/shares into the shares table and the owed row. The owed totals
 * are priced at the server's clock of this call, so a test that fakes Date
 * fakes it around this call (and its reads). A session and an address of its
 * own: a request made under a future fake clock leaves a future rate-limit
 * window on its keys, which must not be one a later request shares.
 */
export async function pullShares(device: Device): Promise<EntityTiming> {
	const headers = {
		authorization: `Bearer ${await longSession(device.userId)}`,
	};
	const started = performance.now();
	const body = await expectBody<SyncSharesDto>(
		await get(device, "/sync/shares", headers),
		contract.sync.shares,
	);
	const fetched = performance.now();
	await device.store.transaction((tx) => applySharesSnapshot(tx, body));
	return {
		fetchMs: fetched - started,
		applyMs: performance.now() - fetched,
		pages: 1,
		rows: body.items.length,
	};
}

/**
 * Pulls everything a device needs, in order, and returns the timings. The
 * cursors are kept, so a second call applies only what changed since the
 * first. `expected` are the row counts the database holds now.
 */
export async function pullAll(
	device: Device,
	expected: ParityLedger["counts"],
	options: { deadlineMs?: number; shares?: boolean } = {},
): Promise<PullReport> {
	const started = performance.now();
	const deadline = started + (options.deadlineMs ?? 60_000);
	const entities: PullReport["entities"] = {};
	entities.settings = await pullSettings(device);
	for (const s of SPECS)
		entities[s.entity] = await s.run(
			device,
			expected[COUNT_OF[s.entity]],
			deadline,
		);
	entities.rates = await pullRates(device);
	if (options.shares !== false) entities.shares = await pullShares(device);
	return { entities, totalMs: performance.now() - started };
}
