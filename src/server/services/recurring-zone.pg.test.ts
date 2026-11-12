/**
 * Recurring due dates step in the user's zone, not the server process's. The
 * user is in Buenos Aires (UTC-3, no DST) with an ARS home currency and the
 * process runs in New York, so a due date stored as Buenos Aires midnight
 * (03:00Z) reads as the evening before in the process's zone. Stepping those
 * local fields put month-end anchors a day off.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { seedArsRatesOn } from "./accounts/test-fixtures";
import {
	confirmRecurringExpense,
	unconfirmRecurringExpense,
} from "./recurring-confirm.mutation";
import { skipRecurring, unskipRecurring } from "./recurring-skip.mutation";
import { listRecurringView } from "./recurring-view.service";

const BUENOS_AIRES = "America/Argentina/Buenos_Aires";
const LOS_ANGELES = "America/Los_Angeles";
const NOW = new Date("2027-05-15T15:00:00Z");

const iso = (date: Date) => date.toISOString();
// Buenos Aires midnight is 03:00Z all year.
const ba = (day: string) => new Date(`${day}T03:00:00.000Z`);

let dropRates: () => Promise<unknown>;
let processZone: string | undefined;

beforeAll(async () => {
	dropRates = await seedArsRatesOn([
		[new Date("2027-01-01T00:00:00Z"), "blue", "1468"],
	]);
});

afterAll(() => dropRates());

beforeEach(() => {
	processZone = process.env.TZ;
	process.env.TZ = "America/New_York";
	vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});

afterEach(() => {
	vi.useRealTimers();
	if (processZone === undefined) delete process.env.TZ;
	else process.env.TZ = processZone;
});

async function userWithTemplate(anchorDay: number | null, firstDue: string) {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: { homeCurrency: "ARS", timeZone: BUENOS_AIRES },
	});
	const template = await fixtureDb.recurringTemplate.create({
		data: {
			userId: user.id,
			name: "Rent",
			amount: "1000",
			currency: "ARS",
			frequency: "MONTHLY",
			nextDueDate: ba(firstDue),
			anchorDay,
			autoPay: false,
		},
	});
	return { userId: user.id, id: template.id };
}

const dueOf = async (id: string) =>
	(await fixtureDb.recurringTemplate.findUniqueOrThrow({ where: { id } }))
		.nextDueDate;

describe("recurring.confirm in a Buenos Aires user's zone", () => {
	it("walks anchor 31 from Jan 31 through Feb 28, Mar 31 and Apr 30", async () => {
		const { userId, id } = await userWithTemplate(31, "2027-01-31");
		const seen: string[] = [];
		for (let i = 0; i < 4; i++) {
			await forUser(userId).apply(confirmRecurringExpense, { templateId: id });
			seen.push(iso(await dueOf(id)));
		}
		expect(seen).toEqual([
			"2027-02-28T03:00:00.000Z",
			"2027-03-31T03:00:00.000Z",
			"2027-04-30T03:00:00.000Z",
			"2027-05-31T03:00:00.000Z",
		]);
		const expenses = await fixtureDb.expense.findMany({
			where: { userId },
			orderBy: { date: "asc" },
		});
		expect(expenses.map((e) => iso(e.date))).toEqual([
			"2027-01-31T03:00:00.000Z",
			"2027-02-28T03:00:00.000Z",
			"2027-03-31T03:00:00.000Z",
			"2027-04-30T03:00:00.000Z",
		]);
		// 1000 ARS at the blue rate of 1468 is 0.6812 USD, 0.68 to the cent.
		expect(
			expenses.map((e) => [
				e.exchangeRate?.toString(),
				e.amountInUSD.toString(),
			]),
		).toEqual(Array(4).fill(["1468", "0.68"]));
	});

	it("stores the template's own day as the anchor when it had none", async () => {
		const { userId, id } = await userWithTemplate(null, "2027-01-31");
		await forUser(userId).apply(confirmRecurringExpense, { templateId: id });
		const row = await fixtureDb.recurringTemplate.findUniqueOrThrow({
			where: { id },
		});
		expect(row.anchorDay).toBe(31);
		expect(iso(row.nextDueDate)).toBe("2027-02-28T03:00:00.000Z");
	});

	it("undoes a confirm back to the due date it settled", async () => {
		const { userId, id } = await userWithTemplate(31, "2027-01-31");
		const { value } = await forUser(userId).apply(confirmRecurringExpense, {
			templateId: id,
		});
		await forUser(userId).apply(unconfirmRecurringExpense, {
			expenseId: value.expenseId,
			dueDate: value.dueAt,
		});
		expect(iso(await dueOf(id))).toBe("2027-01-31T03:00:00.000Z");
	});
});

describe("recurring.skip in a Buenos Aires user's zone", () => {
	it("skips Jan 31 to Feb 28 and unskips back", async () => {
		const { userId, id } = await userWithTemplate(31, "2027-01-31");
		const { value } = await forUser(userId).apply(skipRecurring, {
			templateId: id,
		});
		expect(iso(value.nextDueAt)).toBe("2027-02-28T03:00:00.000Z");
		await forUser(userId).apply(unskipRecurring, {
			templateId: id,
			dueDate: value.dueAt,
		});
		expect(iso(await dueOf(id))).toBe("2027-01-31T03:00:00.000Z");
	});
});

describe("recurring view in a Buenos Aires user's zone", () => {
	it("shows the day after Jan 31 on anchor 31 as Feb 28", async () => {
		const { userId } = await userWithTemplate(31, "2027-01-31");
		const view = await listRecurringView(adminDb, userId, BUENOS_AIRES);
		expect(view.items.map((i) => [i.next, i.nextAfter])).toEqual([
			["2027-01-31", "2027-02-28"],
		]);
	});

	it("steps in the saved zone when the request comes from Los Angeles", async () => {
		const { userId } = await userWithTemplate(31, "2027-01-31");
		const view = await listRecurringView(adminDb, userId, LOS_ANGELES);
		// Feb 28 00:00 in Buenos Aires (03:00Z) is still Feb 27 in Los Angeles.
		// Stepping in Los Angeles would give Feb 28 19:00 there, Mar 1 03:00Z.
		expect(view.items.map((i) => [i.next, i.nextAfter])).toEqual([
			["2027-01-30", "2027-02-27"],
		]);
	});
});

describe("a request from another zone than the saved one", () => {
	it("confirms Jan 31 to Feb 28 and stores anchor 31, not Los Angeles's 30", async () => {
		const { userId, id } = await userWithTemplate(null, "2027-01-31");
		await forUser(userId).apply(confirmRecurringExpense, {
			templateId: id,
			timeZone: LOS_ANGELES,
		});
		const row = await fixtureDb.recurringTemplate.findUniqueOrThrow({
			where: { id },
		});
		expect(iso(row.nextDueDate)).toBe("2027-02-28T03:00:00.000Z");
		expect(row.anchorDay).toBe(31);
	});

	it("books March after February when confirming from Los Angeles", async () => {
		const { userId, id } = await userWithTemplate(31, "2027-01-31");
		for (let i = 0; i < 2; i++)
			await forUser(userId).apply(confirmRecurringExpense, {
				templateId: id,
				timeZone: LOS_ANGELES,
			});
		expect(iso(await dueOf(id))).toBe("2027-03-31T03:00:00.000Z");
	});

	it("skips and unskips from Los Angeles on the saved zone's days", async () => {
		const { userId, id } = await userWithTemplate(31, "2027-01-31");
		const { value } = await forUser(userId).apply(skipRecurring, {
			templateId: id,
			timeZone: LOS_ANGELES,
		});
		expect(iso(value.nextDueAt)).toBe("2027-02-28T03:00:00.000Z");
		await forUser(userId).apply(unskipRecurring, {
			templateId: id,
			dueDate: value.dueAt,
		});
		expect(iso(await dueOf(id))).toBe("2027-01-31T03:00:00.000Z");
	});
});

describe("recurring.confirm on an income template", () => {
	it("steps UTC days and anchors on the UTC day, not Buenos Aires's", async () => {
		const { user } = await createTestUser();
		await adminDb.user.update({
			where: { id: user.id },
			data: { homeCurrency: "ARS", timeZone: BUENOS_AIRES },
		});
		// Income keeps its day as UTC midnight: Jan 31 00:00Z is Jan 30 21:00 in
		// Buenos Aires, where stepping would give Feb 28 03:00Z and anchor 30.
		const { id } = await fixtureDb.recurringTemplate.create({
			data: {
				userId: user.id,
				name: "Salary",
				amount: "1000",
				currency: "ARS",
				direction: "IN",
				frequency: "MONTHLY",
				nextDueDate: new Date("2027-01-31T00:00:00.000Z"),
				anchorDay: null,
				autoPay: false,
			},
		});
		await forUser(user.id).apply(confirmRecurringExpense, { templateId: id });
		const row = await fixtureDb.recurringTemplate.findUniqueOrThrow({
			where: { id },
		});
		expect(iso(row.nextDueDate)).toBe("2027-02-28T00:00:00.000Z");
		expect(row.anchorDay).toBe(31);
	});
});

describe("recurring.unconfirm", () => {
	it("is refused once the saved zone moved so the step no longer matches", async () => {
		const { userId, id } = await userWithTemplate(31, "2027-01-31");
		const { value } = await forUser(userId).apply(confirmRecurringExpense, {
			templateId: id,
		});
		// Tokyo reads Jan 31 03:00Z as Jan 31 12:00 and steps to Feb 27 15:00Z.
		await adminDb.user.update({
			where: { id: userId },
			data: { timeZone: "Asia/Tokyo" },
		});
		await expect(
			forUser(userId).apply(unconfirmRecurringExpense, {
				expenseId: value.expenseId,
				dueDate: value.dueAt,
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(iso(await dueOf(id))).toBe("2027-02-28T03:00:00.000Z");
		expect(await fixtureDb.expense.count({ where: { userId } })).toBe(1);
	});

	it("puts a null anchor back, so the undo is exact", async () => {
		const { userId, id } = await userWithTemplate(null, "2027-01-31");
		const { value } = await forUser(userId).apply(confirmRecurringExpense, {
			templateId: id,
		});
		expect(value.anchorDay).toBeNull();
		await forUser(userId).apply(unconfirmRecurringExpense, {
			expenseId: value.expenseId,
			dueDate: value.dueAt,
			anchorDay: value.anchorDay,
		});
		const row = await fixtureDb.recurringTemplate.findUniqueOrThrow({
			where: { id },
		});
		expect(row.anchorDay).toBeNull();
		expect(iso(row.nextDueDate)).toBe("2027-01-31T03:00:00.000Z");
	});

	it("leaves the anchor alone when the undo carries none", async () => {
		const { userId, id } = await userWithTemplate(31, "2027-01-31");
		const { value } = await forUser(userId).apply(confirmRecurringExpense, {
			templateId: id,
		});
		await forUser(userId).apply(unconfirmRecurringExpense, {
			expenseId: value.expenseId,
			dueDate: value.dueAt,
		});
		const row = await fixtureDb.recurringTemplate.findUniqueOrThrow({
			where: { id },
		});
		expect(row.anchorDay).toBe(31);
	});
});
