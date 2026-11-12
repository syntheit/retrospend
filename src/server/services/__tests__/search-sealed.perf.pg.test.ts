/**
 * The search hot paths over a large sealed ledger (E2EE D11 PR 7.0), with no
 * opened-text cache. Search and Activity scan every row and open every cell
 * on every call; this file measures what that costs on real Postgres, so a
 * cache is built only if a number says it is needed
 * (docs/roadmap/e2ee-d11-pr7-8.md, 7.0 and Critic round 1 items 3 and 4).
 *
 * The ledger is written through the real write path with sealing on (12,000
 * expenses, 2,000 shared expenses, 600 payments, 400 ghosts, 150 projects),
 * and read with the epoch set, so every read is the app-layer path. Every run
 * asserts correctness and prints timings. The time budgets are asserted only
 * with PERF_BUDGET=harbor, on the machine they were measured on (never in
 * GitHub CI), and are never loosened. ARS home.
 *
 * It runs alone, after the parallel files (vitest.pg.config.ts, `pg-perf`),
 * and builds its own keys, so it is not in the sealed suite
 * (sealed-suite.exclude.json). Run it by itself with `pnpm test:pg:perf`.
 */

import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Keyring } from "~/server/crypto/field-crypto";
import { setSealingForTests } from "~/server/crypto/sealing";
import { createUserScopedDb } from "~/server/db";
import { listActivity } from "~/server/services/expense-list";
import { listV2Input } from "~/server/services/expense-list/types";
import { importReview } from "~/server/services/import/review";
import {
	searchExpenses,
	searchPeople,
	searchProjects,
} from "~/server/services/search.service";
import { titleSuggestions } from "~/server/services/title-suggestions.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	instanceKeyring,
	sealedFile,
	unsealAll,
	userKeyring,
	writeEpoch,
} from "~/test/sealed-fixture";
import type { Prisma } from "~prisma";
import {
	arsUser,
	daysAgo,
	isoDay,
	seedArsRates,
	TODAY,
} from "../accounts/test-fixtures";

const master = vi.hoisted(() => ({ ring: undefined as Keyring | undefined }));
vi.mock("~/server/crypto/master-key", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/crypto/master-key")>()),
	getMasterKeyring: () => master.ring,
}));
// Counts every cell the app opens, to price the opens against the wall time.
const opens = vi.hoisted(() => ({ n: 0, ms: 0 }));
vi.mock("~/server/crypto/field-crypto", async (importOriginal) => {
	const real =
		await importOriginal<typeof import("~/server/crypto/field-crypto")>();
	return {
		...real,
		openField: (...args: Parameters<typeof real.openField>) => {
			opens.n++;
			const started = performance.now();
			const text = real.openField(...args);
			opens.ms += performance.now() - started;
			return text;
		},
	};
});
sealedFile(master);

const TZ = "America/Argentina/Buenos_Aires";
const NOW = new Date();
/** Budgets below were measured on harbor with no cache (3 runs, 2026-11-12). */
const ENFORCE = process.env.PERF_BUDGET === "harbor";
/** The plan's go/no-go line for building the cache (7.0). */
const STALL_LIMIT_MS = 120;
const OPEN_COST_MS = 0.0045;

const EXPENSES = 12_000;
const SHARED = 2_000;
const PAYMENTS = 600;
const GHOSTS = 400;
const PROJECTS = 150;
const WORDS = [
	"Market",
	"Coffee",
	"Pharmacy",
	"Taxi",
	"Rent",
	"Gym",
	"Bakery",
	"Books",
	"Cinema",
	"Fuel",
	"Hardware",
	"Butcher",
	"Pizza",
	"Subway",
	"Laundry",
	"Parking",
	"Tickets",
	"Flowers",
	"Dentist",
	"Garden",
	"Shoes",
	"Kiosk",
	"Water",
	"Phone",
	"Internet",
	"Insurance",
	"Toys",
	"Vet",
	"Pasta",
	"Fruit",
	"Tools",
	"Paint",
	"Gifts",
	"Snacks",
	"Juice",
	"Bus",
	"Ferry",
	"Hotel",
	"Museum",
	"Repairs",
];
const NAMES = [
	"Ana",
	"Bruno",
	"Carla",
	"Diego",
	"Elena",
	"Fede",
	"Gaby",
	"Hugo",
];
/** Absent from every seeded text, so a search for one reads every row and matches none. */
const NO_MATCH = ["zzqq1", "zzqq2", "zzqq3", "zzqq4", "zzqq5"];
const NEEDLE = "quokkaneedle";

const titleOf = (i: number) => `${WORDS[i % WORDS.length]} ${(i * 7) % 50}`;
const noteOf = (i: number, word: string) =>
	i % 5 < 2 ? `${word} note ${i}` : null;
const placeOf = (i: number) => (i % 10 < 3 ? `Place ${i % 97}` : null);
const sharedTitle = (i: number) =>
	`Dinner ${WORDS[(i * 3) % WORDS.length]} ${i}`;
const sharedNote = (i: number) => (i % 10 < 3 ? `Shared note ${i}` : null);
const day = (i: number) =>
	new Date(TODAY.getTime() + 15 * 3_600_000 - (i % 1095) * 86_400_000);
/** The row that holds the unique needle: expense 4,321's description. */
const NEEDLE_ROW = 4321;

type Seeded = { userId: string; expenseIds: string[]; ghostNames: string[] };
let s: Seeded;
let master1: Keyring;

// ---- timing ------------------------------------------------------------------

type Timing = {
	name: string;
	ms: number[];
	stall: number;
	opens: number;
	/** Time spent inside openField per run, measured, not estimated. */
	openMs: number;
};
const timings: Timing[] = [];

/** Runs `fn` `times` times (after one warm-up when `warm`), recording wall time, loop stall and opens. */
async function measure<T>(
	name: string,
	fn: (round: number) => Promise<T>,
	times = 3,
	warm = true,
): Promise<{ results: T[]; timing: Timing }> {
	if (warm) await fn(0);
	const histogram = monitorEventLoopDelay({ resolution: 10 });
	histogram.enable();
	const ms: number[] = [];
	const results: T[] = [];
	opens.n = 0;
	opens.ms = 0;
	for (let round = 0; round < times; round++) {
		const started = performance.now();
		results.push(await fn(round));
		ms.push(performance.now() - started);
	}
	histogram.disable();
	const timing = {
		name,
		ms,
		stall: histogram.max / 1e6,
		opens: Math.round(opens.n / times),
		openMs: opens.ms / times,
	};
	timings.push(timing);
	return { results, timing };
}

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const median = (xs: number[]) => sorted(xs)[Math.floor(xs.length / 2)] ?? 0;
const p95 = (xs: number[]) =>
	sorted(xs)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)] ?? 0;

/**
 * The time budget: asserted only under PERF_BUDGET=harbor, as 3x the median of
 * the harbor runs rounded up to 100 ms (the measured number is in the comment
 * at each call). The event loop stall is held to the plan's line.
 */
function withinBudget(t: Timing, budgetMs: number, typing = false) {
	const wall = typing ? p95(t.ms) : median(t.ms);
	process.stderr.write(
		`perf ${t.name}: median ${Math.round(median(t.ms))} ms, p95 ${Math.round(p95(t.ms))} ms, loop stall ${Math.round(t.stall)} ms, ${t.opens} opens, ${t.openMs.toFixed(1)} ms in openField (${Math.round((t.openMs * 100) / Math.max(median(t.ms), 1))}% of wall; ${Math.round((t.opens * OPEN_COST_MS * 100) / Math.max(median(t.ms), 1))}% at the plan's 4.5 us)\n`,
	);
	if (!ENFORCE) return;
	expect(wall, `${t.name} wall time`).toBeLessThan(budgetMs);
	expect(t.stall, `${t.name} event loop stall`).toBeLessThan(STALL_LIMIT_MS);
}

// ---- the ledger --------------------------------------------------------------

const chunks = <T>(rows: T[], size: number): T[][] =>
	Array.from({ length: Math.ceil(rows.length / size) }, (_, i) =>
		rows.slice(i * size, (i + 1) * size),
	);

async function seedLedger(): Promise<Seeded> {
	const { user } = await arsUser();
	const userId = user.id;
	await userKeyring(userId, master1);
	await instanceKeyring(master1);
	setSealingForTests(() => true);
	const scoped = createUserScopedDb(userId);

	const expenseIds = Array.from({ length: EXPENSES }, () => randomUUID());
	for (const [c, ids] of chunks(expenseIds, 2000).entries()) {
		await scoped.expense.createMany({
			data: ids.map((id, k) => {
				const i = c * 2000 + k;
				const word = WORDS[i % WORDS.length] ?? "";
				return {
					id,
					userId,
					title: titleOf(i),
					description:
						i === NEEDLE_ROW ? `Lunch ${NEEDLE} bill` : noteOf(i, word),
					location: placeOf(i),
					amount: 1000 + i,
					currency: "ARS",
					date: day(i),
					exchangeRate: 1468,
					amountInUSD: 1,
					pricingSource: "MANUAL",
				};
			}),
		});
	}

	const sharedIds = Array.from({ length: SHARED }, () => randomUUID());
	for (const [c, ids] of chunks(sharedIds, 1000).entries()) {
		const offset = c * 1000;
		await adminDb.sharedTransaction.createMany({
			data: ids.map((id, k) => ({
				id,
				description: sharedTitle(offset + k),
				notes: sharedNote(offset + k),
				amount: "30000",
				currency: "ARS",
				exchangeRate: "1468",
				date: day((offset + k) * 5),
				paidByType: "user" as const,
				paidById: userId,
				createdByType: "user" as const,
				createdById: userId,
			})),
		});
	}
	await adminDb.splitParticipant.createMany({
		data: sharedIds.map((transactionId) => ({
			transactionId,
			participantType: "user" as const,
			participantId: userId,
			shareAmount: "15000",
			verificationStatus: "ACCEPTED" as const,
		})),
	});

	const paymentIds = Array.from({ length: PAYMENTS }, () => randomUUID());
	await adminDb.payment.createMany({
		data: paymentIds.map((id, i) => ({
			id,
			payerType: "user" as const,
			payerId: userId,
			payeeType: "user" as const,
			payeeId: userId,
			amount: "15000",
			currency: "ARS",
			paidOn: day(i * 11),
			recordedByType: "user" as const,
			recordedById: userId,
			note: `Settle note ${i}`,
			paymentMethod: "Transfer",
		})),
	});
	await adminDb.settlement.createMany({
		data: paymentIds.flatMap((paymentGroupId, i) =>
			Array.from({ length: 1 + (i % 3) }, (_, leg) => ({
				id: randomUUID(),
				fromParticipantType: "user" as const,
				fromParticipantId: userId,
				toParticipantType: "user" as const,
				toParticipantId: userId,
				currency: "ARS",
				amount: "5000",
				status: "FINALIZED" as const,
				initiatedAt: day(i * 11),
				paymentGroupId,
				note: `Settle note ${i} leg ${leg}`,
				paymentMethod: "Transfer",
			})),
		),
	});

	const ghostNames = Array.from(
		{ length: GHOSTS },
		(_, i) => `${NAMES[i % NAMES.length]} Ghost ${i}`,
	);
	await adminDb.shadowProfile.createMany({
		data: ghostNames.map((name) => ({ createdById: userId, name })),
	});

	const projectIds = Array.from({ length: PROJECTS }, () => randomUUID());
	await adminDb.project.createMany({
		data: projectIds.map((id, i) => ({
			id,
			name: `Trip ${WORDS[i % WORDS.length]} ${i}`,
			description:
				i % 3 === 0 ? `Plans for ${WORDS[(i + 5) % WORDS.length]}` : null,
			createdById: userId,
		})),
	});
	await adminDb.projectParticipant.createMany({
		data: projectIds.map((projectId) => ({
			projectId,
			participantType: "user" as const,
			participantId: userId,
			role: "ORGANIZER" as const,
		})),
	});
	// Eight other members, so the people search has accounts to open too.
	const others = await Promise.all(
		NAMES.map(async (name) => {
			const other = await createTestUser();
			await adminDb.user.update({
				where: { id: other.user.id },
				data: { name: `${name} Member` },
			});
			return other.user.id;
		}),
	);
	await adminDb.projectParticipant.createMany({
		data: others.map((participantId, i) => ({
			projectId: projectIds[i] ?? "",
			participantType: "user" as const,
			participantId,
			role: "CONTRIBUTOR" as const,
		})),
	});

	setSealingForTests();
	return { userId, expenseIds, ghostNames };
}

beforeAll(async () => {
	master1 = master.ring as Keyring;
	await seedArsRates();
	s = await seedLedger();
	await writeEpoch(true);
}, 600_000);

afterAll(async () => {
	process.stderr.write(
		`perf summary (median ms): ${timings
			.map((t) => `${t.name}=${Math.round(median(t.ms))}`)
			.join(", ")}\n`,
	);
	setSealingForTests();
	await writeEpoch(false);
	await unsealAll();
}, 300_000);

const me = () => createUserScopedDb(s.userId);
const activity = (q?: string) =>
	listActivity(
		me(),
		s.userId,
		listV2Input.parse(q === undefined ? {} : { q }),
		TZ,
		NOW,
	);
const folded = (text: string | null) => (text ?? "").toLowerCase();

describe("the ledger is sealed at rest", () => {
	it("holds ciphertext in titles, notes and names, and the needle nowhere in the clear", async () => {
		const [row] = await adminDb.$queryRaw<
			{ sealed: number; plain: number; needle: number }[]
		>`
			SELECT
				count(*) FILTER (WHERE starts_with(title, E'\\x01'))::int AS sealed,
				count(*) FILTER (WHERE NOT starts_with(title, E'\\x01'))::int AS plain,
				count(*) FILTER (WHERE description ILIKE ${`%${NEEDLE}%`})::int AS needle
			FROM expense WHERE "userId" = ${s.userId}`;
		expect(row).toEqual({ sealed: EXPENSES, plain: 0, needle: 0 });
		const [shared] = await adminDb.$queryRaw<{ n: number }[]>`
			SELECT count(*)::int AS n FROM shared_transaction st
			JOIN split_participant sp ON sp."transactionId" = st.id AND sp."participantId" = ${s.userId}
			WHERE starts_with(st.description, E'\\x01')`;
		expect(shared?.n).toBe(SHARED);
		const [ghost] = await adminDb.$queryRaw<{ n: number }[]>`
			SELECT count(*)::int AS n FROM shadow_profile
			WHERE "createdById" = ${s.userId} AND starts_with(name, E'\\x01')`;
		expect(ghost?.n).toBe(GHOSTS);
	});
});

describe("Activity", () => {
	it("lists the first page with no search (SQL keys, no scan)", async () => {
		const { results, timing } = await measure("activity, no search", () =>
			activity(),
		);
		for (const r of results) {
			expect(r.items).toHaveLength(50);
			expect(r.nextCursor).not.toBeNull();
		}
		// budget: 3x the median of the harbor runs (65 ms), rounded up to 100 ms
		withinBudget(timing, 200);
	});

	it("a no-match search reads and opens every row and finds nothing", async () => {
		const { results, timing } = await measure("activity, no-match q", () =>
			activity(NO_MATCH[0]),
		);
		for (const r of results) {
			expect(r.items).toEqual([]);
			expect(r.count).toBe(0);
		}
		// A scan that reads nothing could not tell: it must have opened the ledger.
		expect(timing.opens).toBeGreaterThanOrEqual(EXPENSES + SHARED);
		// budget: 3x the median of the harbor runs (224 ms), rounded up to 100 ms
		withinBudget(timing, 700);
	});

	it("a matching search counts what the seed holds", async () => {
		const want =
			Array.from({ length: EXPENSES }, (_, i) => i).filter((i) =>
				[
					titleOf(i),
					noteOf(i, WORDS[i % WORDS.length] ?? "") ?? "",
					placeOf(i) ?? "",
				].some((t) => folded(t).includes("bakery")),
			).length +
			Array.from({ length: SHARED }, (_, i) => i).filter((i) =>
				[sharedTitle(i), sharedNote(i) ?? ""].some((t) =>
					folded(t).includes("bakery"),
				),
			).length;
		expect(want).toBeGreaterThan(100);
		const { results, timing } = await measure("activity, matching q", () =>
			activity("bakery"),
		);
		for (const r of results) {
			expect(r.count).toBe(want);
			expect(r.items).toHaveLength(50);
			// Every note repeats its title's word, so a hit's title holds it too.
			expect(r.items.every((i) => folded(i.title).includes("bakery"))).toBe(
				true,
			);
		}
		// budget: 3x the median of the harbor runs (226 ms), rounded up to 100 ms
		withinBudget(timing, 700);
	});

	it("typing: five different no-match needles, one after the other", async () => {
		const { results, timing } = await measure(
			"activity, typing",
			(round) => activity(NO_MATCH[round % NO_MATCH.length]),
			NO_MATCH.length,
			false,
		);
		for (const r of results) expect(r.items).toEqual([]);
		// budget: 3x the p95 of the harbor runs (238 ms), rounded up to 100 ms
		withinBudget(timing, 800, true);
	});

	it("the unique needle finds exactly its row", async () => {
		const r = await activity(NEEDLE);
		expect(r.items.map((i) => i.id)).toEqual([s.expenseIds[NEEDLE_ROW]]);
		expect(r.count).toBe(1);
	});
});

describe("v1 expense search", () => {
	it("a no-match needle reads every row and returns nothing", async () => {
		const { results, timing } = await measure("v1 search, no-match", () =>
			searchExpenses(adminDb, s.userId, NO_MATCH[0] ?? "", {
				after: null,
				take: 50,
			}),
		);
		for (const r of results) expect(r).toEqual([]);
		expect(timing.opens).toBeGreaterThanOrEqual(EXPENSES);
		// budget: 3x the median of the harbor runs (145 ms), rounded up to 100 ms
		withinBudget(timing, 500);
	});

	it("the unique needle returns exactly its row", async () => {
		const hits = await searchExpenses(adminDb, s.userId, NEEDLE, {
			after: null,
			take: 50,
		});
		expect(hits.map((h) => h.id)).toEqual([s.expenseIds[NEEDLE_ROW]]);
	});

	it("a matching needle pages newest first", async () => {
		const hits = await searchExpenses(adminDb, s.userId, "bakery", {
			after: null,
			take: 20,
		});
		expect(hits).toHaveLength(20);
		const dates = hits.map((h) => h.date.getTime());
		expect(dates).toEqual(sorted(dates).reverse());
		expect(hits.every((h) => folded(h.title).includes("bakery"))).toBe(true);
	});
});

describe("title suggestions while typing", () => {
	/** What the seed says "market" should rank first: the most used title containing it. */
	function expectedTop(query: string) {
		const counts = new Map<string, number>();
		for (let i = 0; i < EXPENSES; i++) {
			const t = titleOf(i);
			if (folded(t).includes(query)) counts.set(t, (counts.get(t) ?? 0) + 1);
		}
		for (let i = 0; i < SHARED; i++) {
			const t = sharedTitle(i);
			if (folded(t).includes(query)) counts.set(t, (counts.get(t) ?? 0) + 1);
		}
		return [...counts.entries()].sort(
			(a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
		);
	}

	it("returns the most used matching titles for each keystroke", async () => {
		const keystrokes = ["m", "ma", "mar", "mark", "marke", "market"];
		const { results, timing } = await measure(
			"title suggestions, typing",
			(round) =>
				titleSuggestions(
					createUserScopedDb(s.userId) as never,
					s.userId,
					keystrokes[round % keystrokes.length] ?? "m",
				),
			keystrokes.length,
			false,
		);
		for (const [round, got] of results.entries()) {
			const query = keystrokes[round] ?? "";
			const want = expectedTop(query).slice(0, 8);
			expect(got.map((g) => [g.title, g.count])).toEqual(want);
		}
		// budget: 3x the p95 of the harbor runs (129 ms), rounded up to 100 ms
		withinBudget(timing, 400, true);
	});

	it("a no-match keystroke returns nothing", async () => {
		const got = await titleSuggestions(
			createUserScopedDb(s.userId) as never,
			s.userId,
			NO_MATCH[0] ?? "",
		);
		expect(got).toEqual([]);
	});
});

describe("global search over people and projects", () => {
	it("finds ghosts and members by name, and nothing for a no-match needle", async () => {
		const want = s.ghostNames.filter((n) => folded(n).includes("ana"));
		expect(want.length).toBe(GHOSTS / NAMES.length);
		const { results, timing } = await measure("search people", async () => [
			await searchPeople(adminDb, s.userId, "ana", { after: null, take: 500 }),
			await searchPeople(adminDb, s.userId, NO_MATCH[0] ?? "", {
				after: null,
				take: 500,
			}),
		]);
		for (const [hit, none] of results) {
			// Ghosts plus the one member named "Ana Member", sorted by name.
			expect(hit?.map((h) => h.name).sort()).toEqual(
				[...want, "Ana Member"].sort(),
			);
			expect(none).toEqual([]);
		}
		// budget: 3x the median of the harbor runs (18 ms), rounded up to 100 ms
		withinBudget(timing, 100);
	});

	it("finds projects by name or description, and nothing for a no-match needle", async () => {
		const want = Array.from({ length: PROJECTS }, (_, i) => i).filter((i) =>
			[
				`Trip ${WORDS[i % WORDS.length]} ${i}`,
				i % 3 === 0 ? `Plans for ${WORDS[(i + 5) % WORDS.length]}` : "",
			].some((t) => folded(t).includes("market")),
		);
		expect(want.length).toBeGreaterThan(0);
		const { results, timing } = await measure("search projects", async () => [
			await searchProjects(adminDb, s.userId, "market", {
				after: null,
				take: 500,
			}),
			await searchProjects(adminDb, s.userId, NO_MATCH[0] ?? "", {
				after: null,
				take: 500,
			}),
		]);
		for (const [hit, none] of results) {
			expect(hit).toHaveLength(want.length);
			expect(none).toEqual([]);
		}
		// budget: 3x the median of the harbor runs (4 ms), rounded up to 100 ms
		withinBudget(timing, 100);
	});
});

describe("import review against the ledger", () => {
	it("marks the copied rows as duplicates and the rest as new", async () => {
		const COPIES = 50;
		const copied = Array.from({ length: EXPENSES }, (_, i) => i)
			// Recent enough to have a rate: 5 to 25 days back.
			.filter((i) => i % 1095 >= 5 && i % 1095 <= 25)
			.slice(0, COPIES);
		expect(copied).toHaveLength(COPIES);
		const row = (title: string, amount: number, date: string) => ({
			title,
			amount,
			currency: "ARS",
			date,
			location: "",
			description: "",
			pricingSource: "IMPORT",
			category: "",
		});
		const rows = [
			...copied.map((i) =>
				row(titleOf(i), 1000 + i, isoDay(daysAgo(i % 1095))),
			),
			...Array.from({ length: 250 }, (_, i) =>
				row(`Bank ${i}`, 900_000 + i * 7, isoDay(daysAgo(5 + (i % 20)))),
			),
		];
		const job = await adminDb.importJob.create({
			data: {
				userId: s.userId,
				status: "READY_FOR_REVIEW",
				type: "CSV",
				fileName: "statement.csv",
				fileSize: 1,
				fileType: "csv",
				transactions: rows as unknown as Prisma.InputJsonValue,
			},
		});
		const { results, timing } = await measure("import review, 300 rows", () =>
			importReview(createUserScopedDb(s.userId), s.userId, job.id, {
				timeZone: TZ,
			}),
		);
		for (const r of results) {
			expect(r.rows).toHaveLength(COPIES + 250);
			expect(r.counts.duplicates).toBe(COPIES);
			expect(r.rows.filter((x) => x.duplicate).map((x) => x.title)).toEqual(
				copied.map((i) => titleOf(i)),
			);
		}
		// budget: 3x the median of the harbor runs (50 ms), rounded up to 100 ms
		withinBudget(timing, 200);
	});
});
