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
import { adminDb, createTestUser } from "~/test/pg-harness";
import { seedArsRatesOn } from "./accounts/test-fixtures";
import {
	confirmRecurringExpense,
	unconfirmRecurringExpense,
} from "./recurring-confirm.mutation";
import { skipRecurring, unskipRecurring } from "./recurring-skip.mutation";
import { listRecurringView } from "./recurring-view.service";

const BUENOS_AIRES = "America/Argentina/Buenos_Aires";
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
	const template = await adminDb.recurringTemplate.create({
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
	(await adminDb.recurringTemplate.findUniqueOrThrow({ where: { id } }))
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
		const expenses = await adminDb.expense.findMany({
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
		const row = await adminDb.recurringTemplate.findUniqueOrThrow({
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
});
