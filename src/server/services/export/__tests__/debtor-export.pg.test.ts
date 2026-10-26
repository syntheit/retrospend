/**
 * Person exports for someone who owes money, on a real Postgres through RLS.
 * Outside a project a debtor sees only their own split row, so the old
 * filter "both people have a split row" found nothing for them and the export
 * said "No shared transactions found". The filter now asks the database for
 * the expenses the two have in common (shared_expense_ids_with), which
 * answers with ids only.
 *
 * Two standalone expenses, Ana paid both:
 *   Dinner  ARS 900:  Ana 300, Ben 300, Cam 300
 *   Taxi    ARS 400:  Ana 200, Ben 200
 * A third, Lunch ARS 100, is Ana and Cam alone: Ben is not on it.
 * Ben owes Ana 300 + 200 = 500.
 *
 * What a debtor cannot see stays hidden: Ana's own row and Cam's row. Their
 * share cells read empty for Ben, never 0.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
	exportCallerFor,
	namedUser,
	seedExpense,
	type TestUser,
} from "./export-fixture";
import { pdfText } from "./pdf-text";

let ana: TestUser;
let ben: TestUser;
let cam: TestUser;
let dan: TestUser;

const who = (u: TestUser) => ({ type: "user" as const, id: u.user.id });
const ref = (u: TestUser) => ({
	participantType: "user" as const,
	participantId: u.user.id,
});

/** The CSV body under its header line: a row per line, cells split on commas. */
function rows(csv: string): string[][] {
	const lines = csv.split("\n").filter((l) => l.length > 0);
	const at = lines.findIndex((l) => l.startsWith("Date,"));
	return lines.slice(at + 1).map((l) => l.split(","));
}

beforeAll(async () => {
	[ana, ben, cam, dan] = await Promise.all([
		namedUser("Ana"),
		namedUser("Ben"),
		namedUser("Cam"),
		namedUser("Dan"),
	]);
	await seedExpense({
		description: "Dinner",
		amount: "900",
		currency: "ARS",
		date: "2026-10-08",
		paidBy: who(ana),
		splits: [
			{ who: who(ana), share: "300" },
			{ who: who(ben), share: "300" },
			{ who: who(cam), share: "300" },
		],
	});
	await seedExpense({
		description: "Taxi",
		amount: "400",
		currency: "ARS",
		date: "2026-10-09",
		paidBy: who(ana),
		splits: [
			{ who: who(ana), share: "200" },
			{ who: who(ben), share: "200" },
		],
	});
	await seedExpense({
		description: "Lunch",
		amount: "100",
		currency: "ARS",
		date: "2026-10-10",
		paidBy: who(ana),
		splits: [
			{ who: who(ana), share: "50" },
			{ who: who(cam), share: "50" },
		],
	});
});

describe("a debtor exports a person's history", () => {
	it("lists the expenses they share with the payer, with their own share and no invented one", async () => {
		const out = await exportCallerFor(ben.user).exportPersonHistory({
			...ref(ana),
			format: "csv",
		});
		const table = rows(out.csv);
		// Newest first: Taxi, then Dinner. Lunch is not Ben's.
		expect(table.map((r) => r[1])).toEqual(["Taxi", "Dinner"]);
		// Your Share is Ben's 200 and 300; Their Share (Ana's row) is hidden.
		expect(table.map((r) => [r[6], r[7]])).toEqual([
			["200", ""],
			["300", ""],
		]);
		expect(out.csv).toContain("Total Transactions: 2");
	});

	it("lists only the expenses they share with another debtor", async () => {
		const out = await exportCallerFor(ben.user).exportPersonHistory({
			...ref(cam),
			format: "csv",
		});
		expect(rows(out.csv).map((r) => r[1])).toEqual(["Dinner"]);
	});

	it("reads the open balance from the pair ledger: Ben owes Ana 500", async () => {
		const out = await exportCallerFor(ben.user).exportPersonSettlementPlan({
			...ref(ana),
			format: "csv",
		});
		expect(out.csv).toContain("ARS,500.00,You owe Ana");
	});

	it("makes the summary PDF for a debtor", async () => {
		const out = await exportCallerFor(ben.user).exportPersonPdf(ref(ana));
		const text = pdfText(Buffer.from(out.pdf, "base64")).join("\n");
		expect(text).toContain("Taxi");
		expect(text).toContain("Dinner");
		expect(text).not.toContain("Lunch");
	});
});

describe("nothing else leaks", () => {
	it("still says there is nothing shared with a stranger", async () => {
		await expect(
			exportCallerFor(ben.user).exportPersonHistory({
				...ref(dan),
				format: "csv",
			}),
		).rejects.toThrow("No shared transactions found");
	});

	it("does not list expenses the caller is not on, whoever they ask about", async () => {
		// Dan is on nothing: asking about Ana finds nothing, though Ana's
		// expenses with Cam and Ben exist.
		await expect(
			exportCallerFor(dan.user).exportPersonHistory({
				...ref(ana),
				format: "csv",
			}),
		).rejects.toThrow("No shared transactions found");
	});

	it("keeps the payer's own export as it was, with both shares", async () => {
		const out = await exportCallerFor(ana.user).exportPersonHistory({
			...ref(ben),
			format: "csv",
		});
		const table = rows(out.csv);
		expect(table.map((r) => [r[1], r[6], r[7]])).toEqual([
			["Taxi", "200", "200"],
			["Dinner", "300", "300"],
		]);
	});
});
