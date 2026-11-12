/**
 * A template's first due day is a calendar date the user picked, kept at the
 * start of that day in their SAVED zone, whatever zone the request comes from
 * and across a DST change that skips midnight. The user is in Buenos Aires
 * (UTC-3, no DST) with an ARS home currency; midnight there is 03:00Z all year.
 * Before the fix a template made from Tokyo stored Tokyo's midnight (Mar 14,
 * 12:00 in Buenos Aires), so the first confirm anchored on the 14th.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { dayKey } from "@retrospend/domain/time-zone";
import { makeSignature } from "better-auth/crypto";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { env } from "~/env";
import { appRouter } from "~/server/api/root";
import {
	asMobile,
	call,
	expectBody,
} from "~/server/api/v1/core/__tests__/harness";
import { createCallerFactory, createTRPCContext } from "~/server/api/trpc";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { seedArsRatesOn } from "./accounts/test-fixtures";
import { confirmRecurringExpense } from "./recurring-confirm.mutation";
import { createRecurring } from "./recurring-create.mutation";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const BUENOS_AIRES = "America/Argentina/Buenos_Aires";
const SANTIAGO = "America/Santiago";
const TOKYO = "Asia/Tokyo";
const LOS_ANGELES = "America/Los_Angeles";
const NOW = new Date("2027-10-15T15:00:00Z");
const createCaller = createCallerFactory(appRouter);

let dropRates: () => Promise<unknown>;

beforeAll(async () => {
	dropRates = await seedArsRatesOn([
		[new Date("2027-01-01T00:00:00Z"), "blue", "1468"],
	]);
});

afterAll(() => dropRates());

afterEach(() => vi.useRealTimers());

const iso = (date: Date) => date.toISOString();

async function userIn(zone: string) {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: { homeCurrency: "ARS", timeZone: zone },
	});
	return user.id;
}

const templateOf = (id: string) =>
	fixtureDb.recurringTemplate.findUniqueOrThrow({ where: { id } });

/** v1 POST /recurring from a request in `requestZone`. */
async function createViaV1(
	userId: string,
	requestZone: string,
	nextDueDate: string,
) {
	const item = await expectBody<{ id: string }>(
		await call("/recurring", {
			method: "POST",
			headers: { ...(await asMobile(userId)), "x-timezone": requestZone },
			body: {
				name: "Rent",
				amount: "1000",
				currency: "ARS",
				frequency: "MONTHLY",
				nextDueDate,
			},
			idempotent: true,
		}),
		contract.recurring.create,
		201,
	);
	return item.id;
}

async function patchViaV1(
	userId: string,
	requestZone: string,
	id: string,
	nextDueDate: string,
) {
	await expectBody(
		await call(`/recurring/${id}`, {
			method: "PATCH",
			headers: { ...(await asMobile(userId)), "x-timezone": requestZone },
			body: { nextDueDate },
			idempotent: true,
		}),
		contract.recurring.update,
	);
}

/** A tRPC caller on a real session, sending the browser's zone header. */
async function trpcFor(userId: string, requestZone: string) {
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
		"x-timezone": requestZone,
	});
	return createCaller(await createTRPCContext({ headers }));
}

async function confirmOnce(userId: string, id: string) {
	vi.useFakeTimers({ toFake: ["Date"], now: NOW });
	await forUser(userId).apply(confirmRecurringExpense, { templateId: id });
	vi.useRealTimers();
	return fixtureDb.expense.findFirstOrThrow({
		where: { userId, recurringTemplateId: id },
	});
}

describe("v1 create from another zone than the saved one", () => {
	it("Tokyo request, Mar 15: stored at Buenos Aires midnight, first confirm books Mar 15 and anchors 15", async () => {
		const userId = await userIn(BUENOS_AIRES);
		const id = await createViaV1(userId, TOKYO, "2027-03-15");
		expect(iso((await templateOf(id)).nextDueDate)).toBe(
			"2027-03-15T03:00:00.000Z",
		);
		const expense = await confirmOnce(userId, id);
		expect(iso(expense.date)).toBe("2027-03-15T03:00:00.000Z");
		expect(dayKey(expense.date, BUENOS_AIRES)).toBe("2027-03-15");
		// 1000 ARS at the blue rate of 1468 is 0.6812 USD, 0.68 to the cent.
		expect([
			expense.exchangeRate?.toString(),
			expense.amountInUSD.toString(),
		]).toEqual(["1468", "0.68"]);
		const row = await templateOf(id);
		expect(row.anchorDay).toBe(15);
		expect(iso(row.nextDueDate)).toBe("2027-04-15T03:00:00.000Z");
	});

	it("Los Angeles request, Mar 15: stored at Buenos Aires midnight too", async () => {
		const userId = await userIn(BUENOS_AIRES);
		const id = await createViaV1(userId, LOS_ANGELES, "2027-03-15");
		expect(iso((await templateOf(id)).nextDueDate)).toBe(
			"2027-03-15T03:00:00.000Z",
		);
		const expense = await confirmOnce(userId, id);
		expect(dayKey(expense.date, BUENOS_AIRES)).toBe("2027-03-15");
		expect((await templateOf(id)).anchorDay).toBe(15);
	});

	it("Tokyo request, Jan 31: anchor 31 survives to Feb 28", async () => {
		const userId = await userIn(BUENOS_AIRES);
		const id = await createViaV1(userId, TOKYO, "2027-01-31");
		expect(iso((await templateOf(id)).nextDueDate)).toBe(
			"2027-01-31T03:00:00.000Z",
		);
		await confirmOnce(userId, id);
		const row = await templateOf(id);
		expect(row.anchorDay).toBe(31);
		expect(iso(row.nextDueDate)).toBe("2027-02-28T03:00:00.000Z");
	});

	it("editing the due day from Tokyo stores Buenos Aires midnight and anchor 31", async () => {
		const userId = await userIn(BUENOS_AIRES);
		const id = await createViaV1(userId, BUENOS_AIRES, "2027-03-15");
		await patchViaV1(userId, TOKYO, id, "2027-01-31");
		const row = await templateOf(id);
		expect(iso(row.nextDueDate)).toBe("2027-01-31T03:00:00.000Z");
		expect(row.anchorDay).toBe(31);
	});
});

describe("the web's tRPC create and update from another zone", () => {
	it("create from Tokyo: the picked Mar 15 (Tokyo midnight) is Buenos Aires Mar 15", async () => {
		const userId = await userIn(BUENOS_AIRES);
		const caller = await trpcFor(userId, TOKYO);
		const made = await caller.recurring.create({
			name: "Rent",
			amount: 1000,
			currency: "ARS",
			frequency: "MONTHLY",
			// Mar 15 at 00:00 in Tokyo (UTC+9).
			nextDueDate: new Date("2027-03-14T15:00:00.000Z"),
			autoPay: true,
		});
		const row = await templateOf(made.id);
		expect(iso(row.nextDueDate)).toBe("2027-03-15T03:00:00.000Z");
		expect(row.anchorDay).toBe(15);
		const expense = await confirmOnce(userId, made.id);
		expect(dayKey(expense.date, BUENOS_AIRES)).toBe("2027-03-15");
	});

	it("create from Los Angeles on Jan 31 (08:00Z in PST): anchor 31", async () => {
		const userId = await userIn(BUENOS_AIRES);
		const caller = await trpcFor(userId, LOS_ANGELES);
		const made = await caller.recurring.create({
			name: "Rent",
			amount: 1000,
			currency: "ARS",
			frequency: "MONTHLY",
			// Jan 31 at 00:00 in Los Angeles (UTC-8).
			nextDueDate: new Date("2027-01-31T08:00:00.000Z"),
			autoPay: true,
		});
		const row = await templateOf(made.id);
		expect(iso(row.nextDueDate)).toBe("2027-01-31T03:00:00.000Z");
		expect(row.anchorDay).toBe(31);
	});

	it("update from Tokyo with a new day stores it at Buenos Aires midnight", async () => {
		const userId = await userIn(BUENOS_AIRES);
		const id = await createViaV1(userId, BUENOS_AIRES, "2027-03-15");
		const caller = await trpcFor(userId, TOKYO);
		await caller.recurring.update({
			id,
			// Jan 31 at 00:00 in Tokyo.
			nextDueDate: new Date("2027-01-30T15:00:00.000Z"),
		});
		const row = await templateOf(id);
		expect(iso(row.nextDueDate)).toBe("2027-01-31T03:00:00.000Z");
		expect(row.anchorDay).toBe(31);
	});

	it("a save that sends the due date back unchanged leaves it alone, whatever zone the browser is in", async () => {
		const userId = await userIn(BUENOS_AIRES);
		const id = await createViaV1(userId, BUENOS_AIRES, "2027-03-15");
		const stored = (await templateOf(id)).nextDueDate;
		// Los Angeles reads 03:00Z Mar 15 as Mar 14, 20:00: a re-save from the
		// edit form must not move the schedule to the 14th.
		const caller = await trpcFor(userId, LOS_ANGELES);
		await caller.recurring.update({
			id,
			name: "Rent, renamed",
			nextDueDate: stored,
		});
		const row = await templateOf(id);
		expect(iso(row.nextDueDate)).toBe("2027-03-15T03:00:00.000Z");
		expect(row.anchorDay).toBe(15);
		expect(row.name).toBe("Rent, renamed");
	});
});

describe("a Santiago user on the day DST skips midnight", () => {
	// Sep 5 2027: 00:00 -04 does not exist, the clock jumps to 01:00 -03 (04:00Z).
	it("create for Sep 5 stores 01:00 that day and the first expense books Sep 5", async () => {
		const userId = await userIn(SANTIAGO);
		const { value } = await forUser(userId).apply(createRecurring, {
			template: {
				name: "Rent",
				amount: "1000",
				currency: "ARS",
				frequency: "MONTHLY",
				nextDueDate: "2027-09-05",
			},
		});
		const row = await templateOf(value.id);
		expect(iso(row.nextDueDate)).toBe("2027-09-05T04:00:00.000Z");
		expect(row.anchorDay).toBe(5);
		const expense = await confirmOnce(userId, value.id);
		expect(dayKey(expense.date, SANTIAGO)).toBe("2027-09-05");
		const after = await templateOf(value.id);
		// Oct 5 is back to midnight, -03: 03:00Z.
		expect(iso(after.nextDueDate)).toBe("2027-10-05T03:00:00.000Z");
		expect(after.anchorDay).toBe(5);
	});

	it("an edit onto Sep 5 stores 01:00 that day too", async () => {
		const userId = await userIn(SANTIAGO);
		const id = await createViaV1(userId, SANTIAGO, "2027-08-05");
		await patchViaV1(userId, SANTIAGO, id, "2027-09-05");
		const row = await templateOf(id);
		expect(iso(row.nextDueDate)).toBe("2027-09-05T04:00:00.000Z");
		expect(row.anchorDay).toBe(5);
	});
});
