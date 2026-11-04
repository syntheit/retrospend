/**
 * An import commit reads days in the user's zone, with no zone in the input,
 * on real Postgres. The instant 2026-11-03T02:00Z is Nov 3 in UTC but still
 * Nov 2, 23:00 in Buenos Aires (UTC-3). A hand-typed expense at 01:00Z is on
 * Nov 2 for a Buenos Aires user, so the same charge in a statement dated
 * Nov 2 is an exact duplicate; read in UTC it is a day apart, only a likely
 * one. A commit without an input zone reads the saved zone; an explicit zone
 * wins. ARS home.
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
import type { Prisma } from "~prisma";
import { seedArsRatesOn } from "../accounts/test-fixtures";
import { commitImport } from "./commit.mutation";

const INSTANT = new Date("2026-11-03T02:00:00Z");
const BUENOS_AIRES = "America/Argentina/Buenos_Aires";

const NOV_2 = new Date("2026-11-02T00:00:00Z");
const NOV_3 = new Date("2026-11-03T00:00:00Z");

// A rate on each day, so a row booked on either has one.
let dropRates: () => Promise<unknown>;
beforeAll(async () => {
	dropRates = await seedArsRatesOn([
		[NOV_2, "blue", "1468"],
		[NOV_3, "blue", "1468"],
	]);
});

afterAll(() => dropRates());

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], now: INSTANT });
});

afterEach(() => {
	vi.useRealTimers();
});

async function commit(timeZone?: string, title = "COTO SUPERMERCADO") {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: { homeCurrency: "ARS", timeZone: BUENOS_AIRES },
	});
	await adminDb.expense.create({
		data: {
			userId: user.id,
			title: "COTO SUPERMERCADO",
			amount: 38200,
			currency: "ARS",
			date: new Date("2026-11-03T01:00:00Z"),
			exchangeRate: 1468,
			amountInUSD: 26,
			pricingSource: "MANUAL",
		},
	});
	const job = await adminDb.importJob.create({
		data: {
			userId: user.id,
			status: "READY_FOR_REVIEW",
			type: "CSV",
			fileName: "statement.csv",
			fileSize: 1,
			fileType: "csv",
			transactions: [
				{
					title,
					amount: 38200,
					currency: "ARS",
					date: "2026-11-02",
					location: "",
					description: "",
					pricingSource: "IMPORT",
					category: "",
				},
			] as unknown as Prisma.InputJsonValue,
		},
	});
	const { value } = await forUser(user.id).apply(commitImport, {
		jobId: job.id,
		rows: [{ index: 0, keep: true, categoryId: null, kind: "expense" }],
		...(timeZone ? { timeZone } : {}),
	});
	return { value, userId: user.id };
}

describe("import commit", () => {
	it("matches on the saved zone's days: the same charge on Nov 2 is skipped", async () => {
		const { value } = await commit();
		expect(value).toMatchObject({ created: 0, duplicates: 1 });
	});

	it("matches on the input zone's days when one is given: a day apart, imported", async () => {
		const { value, userId } = await commit("UTC");
		expect(value).toMatchObject({ created: 1, duplicates: 0 });
		const imported = await adminDb.expense.findFirstOrThrow({
			where: { userId, importFingerprint: { not: null } },
		});
		expect(imported.date).toEqual(new Date("2026-11-02T00:00:00Z"));
	});

	it("dates an imported row at its day's midnight in the saved zone", async () => {
		const { userId } = await commit(undefined, "FARMACITY");
		const imported = await adminDb.expense.findFirstOrThrow({
			where: { userId, importFingerprint: { not: null } },
		});
		expect(imported.date).toEqual(new Date("2026-11-02T03:00:00Z"));
	});
});
