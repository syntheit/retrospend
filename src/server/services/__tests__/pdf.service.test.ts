import { describe, expect, it } from "vitest";
import {
	generatePersonPdf,
	generateProjectPdf,
	type PersonPdfData,
	type ProjectPdfData,
} from "../pdf.service";

function inspectPdf(buffer: Buffer) {
	const text = buffer.toString("latin1");
	const pageObjects = text.match(/\/Type \/Page\b(?!s)/g)?.length ?? 0;
	const counts = [...text.matchAll(/\/Type \/Pages[\s\S]*?\/Count (\d+)/g)].map(
		(m) => Number(m[1]),
	);
	return {
		header: text.slice(0, 5),
		endsWithEof: text.trimEnd().endsWith("%%EOF"),
		pageObjects,
		pageCount: counts[0] ?? 0,
	};
}

function expenses(n: number) {
	return Array.from({ length: n }, (_, i) => ({
		date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
		description: `Expense ${i + 1} with a reasonably long description`,
		amount: 10 + i,
		currency: "EUR",
		category: i % 2 ? "Food" : "Travel",
		paidBy: i % 2 ? "Alice" : "Bob",
	}));
}

const project: ProjectPdfData = {
	projectName: "Lisbon trip",
	status: "ACTIVE",
	primaryCurrency: "EUR",
	description: "Spring trip",
	periodLabel: "Jan 2026",
	participants: [
		{ name: "Alice", role: "ORGANIZER" },
		{ name: "Bob", role: "EDITOR" },
	],
	totalSpent: 1234.5,
	expenseCount: 120,
	budgetAmount: 2000,
	categoryBreakdown: [
		{ category: "Food", count: 60, total: 600 },
		{ category: "Travel", count: 60, total: 634.5 },
	],
	balances: [
		{ name: "Alice", paid: 700, fairShare: 617.25, net: 82.75 },
		{ name: "Bob", paid: 534.5, fairShare: 617.25, net: -82.75 },
	],
	settlements: [{ from: "Bob", to: "Alice", amount: 82.75, currency: "EUR" }],
	expenses: expenses(120),
};

const person: PersonPdfData = {
	personName: "Alice",
	participantType: "user",
	balances: [{ currency: "EUR", amount: 42, direction: "they_owe_you" }],
	relationshipStats: {
		transactionCount: 3,
		projectCount: 1,
		firstTransactionDate: "2026-01-01",
	},
	projectBreakdown: [{ projectName: "Lisbon trip", transactionCount: 3 }],
	categoryBreakdown: [
		{ category: "Food", count: 3, total: 90, currency: "EUR" },
	],
	expenses: expenses(3).map((e) => ({
		...e,
		yourShare: e.amount / 2,
		theirShare: e.amount / 2,
		project: "Lisbon trip",
	})),
};

describe("pdf.service (pdfkit)", () => {
	it("generates a valid multi-page project PDF", async () => {
		const pdf = await generateProjectPdf(project);
		const info = inspectPdf(pdf);
		expect(Buffer.isBuffer(pdf)).toBe(true);
		expect(info.header).toBe("%PDF-");
		expect(info.endsWithEof).toBe(true);
		expect(info.pageCount).toBeGreaterThan(1);
		expect(info.pageObjects).toBe(info.pageCount);
	});

	it("generates a valid single-page person PDF", async () => {
		const pdf = await generatePersonPdf(person);
		const info = inspectPdf(pdf);
		expect(info.header).toBe("%PDF-");
		expect(info.endsWithEof).toBe(true);
		expect(info.pageCount).toBe(1);
		expect(info.pageObjects).toBe(1);
	});
});
