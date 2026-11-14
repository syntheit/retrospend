/**
 * The parity harness at the size of a real ledger (E2EE P16, plan test F):
 * 10,000 expenses, 3,000 legs, 500 shares, dense daily rates, six profiles.
 * One ledger is pulled once through the real routes; each profile is then a
 * user update, a re-pull of settings and shares, and the same comparison as
 * the always-on harness. The perf project runs it alone after every other
 * file (vitest.pg.config.ts), so the timings are not skewed.
 *
 * It asserts parity only; the timings are logged (a budget comes after two CI
 * runs, as the search benchmark's is owner-machine-only). It skips itself in
 * the sealed suite: sealing 10,000 rows is a different test, and the
 * always-on harness already covers sealed parity.
 */
import { randomUUID } from "node:crypto";
import { FigurePass, readFiguresIn } from "@retrospend/domain/figures/registry";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb, fixtureDb, sealedSuite } from "~/test/pg-harness";
import {
	createDevicePreviewRunner,
	deviceFigures,
	EXPENSE_CREATE_MUTATION,
} from "../../../packages/engine/src/index";
import { type LedgerProfile, P13_PROFILES, seedRates } from "../device-ledger";
import {
	deviceReadFrom,
	expectParity,
	SCOPELESS_IDS,
	serverRead,
} from "./compare";
import { LARGE_SIZE, type ParityLedger, seedParityLedger } from "./ledger";
import {
	type Device,
	expectedCounts,
	newDevice,
	type PullReport,
	pullAll,
	pullSettings,
	pullShares,
} from "./pull";
import { dropParityRates, type RateSeed, seedParityRates } from "./rates";
import { addUnpricedShare, dropUnpricedShare } from "./seed-shares";

vi.setConfig({ testTimeout: 600_000, hookTimeout: 900_000 });

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const CLOCK = new Date("2026-10-15T15:00:00Z");

/** Six profiles: the five of the device conformance test that need no unpriced row, and Kuwait. */
const PROFILES: Record<string, LedgerProfile> = {
	...Object.fromEntries(
		Object.entries(P13_PROFILES).filter(([, p]) => !p.withMissingRate),
	),
	"KWD home, Kuwait, month from the 28th": {
		home: "KWD",
		timeZone: "Asia/Kuwait",
		startDay: 28,
	},
};

const median = (xs: number[]) =>
	[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const ms = (n: number) => Math.round(n * 10) / 10;

const previousDefaultZone = process.env.DEFAULT_TIME_ZONE;
let rateSeed: RateSeed;
let ledger: ParityLedger;
let device: Device;
let initial: PullReport;
const log = (label: string, value: unknown) =>
	console.info(`[parity-10k] ${label} ${JSON.stringify(value)}`);

async function atClock<T>(fn: () => Promise<T>): Promise<T> {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(CLOCK);
	try {
		return await fn();
	} finally {
		vi.useRealTimers();
	}
}

describe.skipIf(sealedSuite)(
	"the device against the server at 10,000 expenses",
	() => {
		beforeAll(async () => {
			process.env.DEFAULT_TIME_ZONE = "Pacific/Auckland";
			await seedRates();
			const seeding = performance.now();
			rateSeed = await seedParityRates(1);
			ledger = await seedParityLedger({
				seed: 20261113,
				size: LARGE_SIZE,
				profile: Object.values(PROFILES)[0] as LedgerProfile,
				edgeProfiles: Object.values(PROFILES),
				clocks: [CLOCK],
			});
			log("seed", {
				ms: ms(performance.now() - seeding),
				rateRows: rateSeed.ids.length,
				counts: ledger.counts,
			});
			device = await newDevice(ledger.userId);
			initial = await pullAll(device, await expectedCounts(ledger.userId), {
				deadlineMs: 300_000,
				shares: false,
			});
			log(
				"pull",
				Object.fromEntries(
					Object.entries(initial.entities).map(([k, v]) => [
						k,
						{
							fetchMs: ms(v.fetchMs),
							applyMs: ms(v.applyMs),
							pages: v.pages,
							rows: v.rows,
						},
					]),
				),
			);
			log("pull total ms", ms(initial.totalMs));
		});

		afterAll(async () => {
			if (rateSeed) await dropParityRates(rateSeed);
			if (previousDefaultZone === undefined)
				delete process.env.DEFAULT_TIME_ZONE;
			else process.env.DEFAULT_TIME_ZONE = previousDefaultZone;
		});

		it("holds the store to the database after the first pull", () => {
			const counts = ledger.counts;
			expect(device.store.list("expenses")).toHaveLength(counts.expenses);
			expect(device.store.list("legs")).toHaveLength(counts.legs);
			expect(device.store.list("accounts")).toHaveLength(counts.accounts);
			expect(device.store.list("recurringTemplates")).toHaveLength(
				counts.templates,
			);
		});

		for (const [name, profile] of Object.entries(PROFILES))
			it(`reads every figure as the server does: ${name}`, async () => {
				await adminDb.user.update({
					where: { id: ledger.userId },
					data: {
						homeCurrency: profile.home,
						timeZone: profile.timeZone,
						fiscalMonthStartDay: profile.startDay,
						defaultRateTypes: profile.defaultRateTypes ?? {},
					},
				});
				const refs = {
					userId: ledger.userId,
					templateIds: ledger.templateIds,
					accountIds: ledger.accountIds,
				};
				const repull = await atClock(async () => {
					const settings = await pullSettings(device);
					const shares = await pullShares(device);
					return { settings, shares };
				});
				const base = [...SCOPELESS_IDS, "accounts.balance"];
				const server: number[] = [];
				const onDevice: number[] = [];
				await atClock(async () => {
					await expectParity(device.store, refs);
					for (let i = 0; i < 5; i++) {
						const s = performance.now();
						await serverRead(ledger.userId, base);
						server.push(performance.now() - s);
						const d = performance.now();
						await deviceReadFrom(device.store, ledger.userId, base);
						onDevice.push(performance.now() - d);
					}
				});
				log(`profile ${name}`, {
					repullSettingsMs: ms(
						repull.settings.fetchMs + repull.settings.applyMs,
					),
					repullSharesMs: ms(repull.shares.fetchMs + repull.shares.applyMs),
					devicePassP50Ms: ms(median(onDevice)),
					serverPassP50Ms: ms(median(server)),
				});
			});

		it("takes a delta round: a delete and a share with no rate, then the undo", async () => {
			await adminDb.user.update({
				where: { id: ledger.userId },
				data: {
					homeCurrency: "ARS",
					timeZone: "Asia/Tokyo",
					fiscalMonthStartDay: 1,
				},
			});
			const refs = {
				userId: ledger.userId,
				templateIds: ledger.templateIds,
				accountIds: ledger.accountIds,
			};
			// A plain row: deleting a parent or the row the legs name would cascade.
			const victim = await fixtureDb.expense.findFirstOrThrow({
				where: {
					userId: ledger.userId,
					entryKind: "STANDARD",
					isAmortizedParent: false,
				},
			});
			await fixtureDb.expense.delete({ where: { id: victim.id } });
			const xqz = await addUnpricedShare(
				ledger.userId,
				ledger.bobId,
				new Date(CLOCK.getTime() - 60_000),
			);
			const delta = await atClock(async () => {
				const report = await pullAll(
					device,
					await expectedCounts(ledger.userId),
				);
				const all = await expectParity(device.store, refs);
				return { report, all };
			});
			log("delta pull total ms", ms(delta.report.totalMs));
			expect(delta.all.server.readings.get("glance.spent")).toBeNull();
			expect(delta.all.server.missing.get("glance.spent")).toEqual(["XQZ"]);
			expect(device.store.get("expenses", victim.id)).toBeUndefined();
			await fixtureDb.expense.create({ data: victim });
			await dropUnpricedShare(xqz);
			await atClock(async () => {
				await pullAll(device, await expectedCounts(ledger.userId));
				await expectParity(device.store, refs);
			});
			expect(device.store.list("expenses")).toHaveLength(
				ledger.counts.expenses,
			);
		});

		it("previews an expense and sorts a list at this size", async () => {
			const input = {
				id: randomUUID(),
				title: "Books",
				amount: "100",
				currency: "USD",
				date: new Date(CLOCK.getTime() - 60 * 60 * 1000),
			};
			const figures = deviceFigures({ clock: () => CLOCK });
			const runner = createDevicePreviewRunner({
				store: device.store,
				figures,
				actor: { userId: ledger.userId },
			});
			const previews: number[] = [];
			for (let i = 0; i < 5; i++) {
				const started = performance.now();
				await runner.preview(EXPENSE_CREATE_MUTATION, input);
				previews.push(performance.now() - started);
			}
			const lists: number[] = [];
			for (let i = 0; i < 5; i++) {
				const started = performance.now();
				device.store.list("expenses");
				lists.push(performance.now() - started);
			}
			log("expense.create preview p50 ms", ms(median(previews)));
			log("list(expenses) p50 ms", ms(median(lists)));
			// The preview left the store as it was.
			expect(device.store.get("expenses", input.id)).toBeUndefined();
			// And read one figure the way a screen does, once, to see the first-read cost.
			const first = performance.now();
			await readFiguresIn(
				device.store,
				[figures.get("spent")],
				{ userId: ledger.userId },
				new FigurePass(),
			);
			log("spent first read ms", ms(performance.now() - first));
		});
	},
);
