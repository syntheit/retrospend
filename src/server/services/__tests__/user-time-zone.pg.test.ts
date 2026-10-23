/**
 * The stored per-user time zone on a real Postgres, through real sessions
 * (better-auth loads user.timeZone into the session) and the tRPC chain.
 * The instant 2026-10-31T20:00Z is Nov 1, 05:00 in Tokyo (UTC+9) and
 * Oct 31, 17:00 in Buenos Aires (UTC-3), so the two users' days differ.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "~/env";
import { dayKey, fromWallTime } from "~/lib/time-zone";
import { appRouter } from "~/server/api/root";
import { createCallerFactory, createTRPCContext } from "~/server/api/trpc";
import { spentFigure } from "~/server/services/figures/spent";
import { adminDb, createTestUser } from "~/test/pg-harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const createCaller = createCallerFactory(appRouter);
const TOKYO = "Asia/Tokyo";
// The runtime's canonical spelling of America/Argentina/Buenos_Aires.
const BUENOS_AIRES = "America/Buenos_Aires";
const INSTANT = new Date("2026-10-31T20:00:00Z");

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

/** A caller signed in as `userId` through a real session cookie. */
async function callerFor(userId: string, zoneHeader?: string) {
	const token = randomBytes(24).toString("hex");
	await adminDb.session.create({
		data: {
			id: randomUUID(),
			token,
			userId,
			expiresAt: new Date("2100-01-01T00:00:00Z"),
		},
	});
	const signature = await makeSignature(token, env.BETTER_AUTH_SECRET ?? "");
	const headers = new Headers({
		cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
	});
	if (zoneHeader) headers.set("x-timezone", zoneHeader);
	return createCaller(await createTRPCContext({ headers }));
}

const storedZone = async (userId: string) =>
	(
		await adminDb.user.findUniqueOrThrow({
			where: { id: userId },
			select: { timeZone: true },
		})
	).timeZone;

afterEach(() => {
	vi.useRealTimers();
});

describe("first signed-in browser request", () => {
	it("stores the browser's zone when none is set, and only then", async () => {
		const { user } = await createTestUser();
		expect(await storedZone(user.id)).toBeNull();

		const first = await callerFor(user.id, "America/Argentina/Buenos_Aires");
		const settings = await first.settings.getGeneral();
		expect(settings.timeZone).toBe(BUENOS_AIRES);
		expect(await storedZone(user.id)).toBe(BUENOS_AIRES);

		// A later request from elsewhere does not move the stored zone.
		const travel = await callerFor(user.id, TOKYO);
		await travel.settings.getGeneral();
		expect(await storedZone(user.id)).toBe(BUENOS_AIRES);
	});

	it("stores nothing for a zone the runtime does not list", async () => {
		const { user } = await createTestUser();
		const caller = await callerFor(user.id, "Etc/GMT+3");
		await caller.settings.getGeneral();
		expect(await storedZone(user.id)).toBeNull();
	});
});

describe("settings.updateGeneral timeZone", () => {
	it("stores a listed zone in its canonical spelling", async () => {
		const { user } = await createTestUser();
		const caller = await callerFor(user.id);
		await caller.settings.updateGeneral({
			timeZone: "America/Argentina/Buenos_Aires",
		});
		expect(await storedZone(user.id)).toBe(BUENOS_AIRES);
	});

	it("rejects a zone that is not on the list", async () => {
		const { user } = await createTestUser();
		await adminDb.user.update({
			where: { id: user.id },
			data: { timeZone: TOKYO },
		});
		const caller = await callerFor(user.id);
		for (const bad of ["Mars/Olympus_Mons", "Etc/GMT+3", "not a zone"]) {
			await expect(
				caller.settings.updateGeneral({ timeZone: bad }),
			).rejects.toThrow("Pick a time zone from the list");
		}
		expect(await storedZone(user.id)).toBe(TOKYO);
	});
});

describe("two users, same instant, their own calendar days", () => {
	let tokyo: TestUser;
	let ba: TestUser;

	beforeAll(async () => {
		tokyo = await createTestUser();
		ba = await createTestUser();
		await adminDb.user.update({
			where: { id: tokyo.user.id },
			data: { timeZone: TOKYO, homeCurrency: "USD" },
		});
		await adminDb.user.update({
			where: { id: ba.user.id },
			data: { timeZone: BUENOS_AIRES, homeCurrency: "USD" },
		});
	});

	it("dates an entry added without a day on each user's today", async () => {
		vi.useFakeTimers({ toFake: ["Date"], now: INSTANT });
		const days: Record<string, string> = {};
		for (const [who, zone] of [
			[tokyo, TOKYO],
			[ba, BUENOS_AIRES],
		] as const) {
			// No x-timezone header (an API client): the stored zone decides.
			const caller = await callerFor(who.user.id);
			const out = await caller.wealth.income.add.save({
				title: "Pay",
				amount: "100",
				currency: "USD",
			});
			const row = await adminDb.expense.findUniqueOrThrow({
				where: { id: out.value.expenseId },
				select: { date: true },
			});
			days[zone] = dayKey(row.date, zone);
		}
		expect(days).toEqual({
			[TOKYO]: "2026-11-01",
			[BUENOS_AIRES]: "2026-10-31",
		});
	});

	it("puts the same instant in each user's own spent() month", async () => {
		for (const who of [tokyo, ba]) {
			const category = await adminDb.category.create({
				data: { name: "Food", color: "orange", userId: who.user.id },
			});
			await adminDb.expense.create({
				data: {
					userId: who.user.id,
					title: "Dinner",
					amount: "40",
					currency: "USD",
					amountInUSD: "40",
					exchangeRate: "1",
					pricingSource: "MANUAL",
					date: INSTANT,
					categoryId: category.id,
				},
			});
		}
		const spent = (who: TestUser) =>
			spentFigure.compute(who.db as never, { userId: who.user.id });
		const dinner = [{ minor: 4000, currency: "USD" }];

		// Mid November: Tokyo's dinner fell on Nov 1, Buenos Aires' on Oct 31.
		vi.useFakeTimers({
			toFake: ["Date"],
			now: new Date("2026-11-15T12:00:00Z"),
		});
		expect(await spent(tokyo)).toEqual(dinner);
		expect(await spent(ba)).toEqual([]);

		vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
		expect(await spent(tokyo)).toEqual([]);
		expect(await spent(ba)).toEqual(dinner);
	});
});

describe("recurring templates are due on the user's own day", () => {
	let tokyo: TestUser;
	let ba: TestUser;
	const templateFor = (who: TestUser, zone: string) =>
		adminDb.recurringTemplate.create({
			data: {
				userId: who.user.id,
				name: "Rent",
				amount: "10",
				currency: "USD",
				frequency: "MONTHLY",
				// The recurring modal saves the due day at local midnight.
				nextDueDate: fromWallTime({ year: 2026, month: 10, day: 1 }, zone),
				autoPay: false,
			},
		});
	const pendingIds = async (who: TestUser) => {
		const caller = await callerFor(who.user.id);
		return (await caller.recurring.getPendingConfirmation()).map((t) => t.id);
	};

	beforeAll(async () => {
		tokyo = await createTestUser();
		ba = await createTestUser();
		await adminDb.user.update({
			where: { id: tokyo.user.id },
			data: { timeZone: TOKYO },
		});
		await adminDb.user.update({
			where: { id: ba.user.id },
			data: { timeZone: BUENOS_AIRES },
		});
	});

	it("lists and confirms a Nov 1 template from Nov 1 in each zone", async () => {
		const forTokyo = await templateFor(tokyo, TOKYO);
		const forBa = await templateFor(ba, BUENOS_AIRES);

		// Nov 1, 05:00 in Tokyo; still Oct 31, 17:00 in Buenos Aires.
		vi.useFakeTimers({ toFake: ["Date"], now: INSTANT });
		expect(await pendingIds(tokyo)).toEqual([forTokyo.id]);
		expect(await pendingIds(ba)).toEqual([]);
		const baCaller = await callerFor(ba.user.id);
		await expect(
			baCaller.recurring.confirmAndCreate({ id: forBa.id }),
		).rejects.toThrow("already confirmed");

		// Nov 1, 00:30 in Buenos Aires (03:30 UTC): due there now.
		vi.setSystemTime(new Date("2026-11-01T03:30:00Z"));
		expect(await pendingIds(ba)).toEqual([forBa.id]);
		await baCaller.recurring.confirmAndCreate({
			id: forBa.id,
			dueDate: forBa.nextDueDate,
		});
		expect(await pendingIds(ba)).toEqual([]);
	});
});
