import { describe, expect, it } from "vitest";
import type {
	NeedsYouItem,
	NeedsYouList,
} from "~/server/services/needs-you/types";
import { namedRates, toNeedsVM, toNeedsVMs, type Words } from "./needs-vm";

const ars = (minor: number) => ({ minor, currency: "ARS" });

const W: Words = {
	context: (key, values) =>
		values ? `${key}(${Object.values(values).join("|")})` : key,
	short: (iso) => `short ${iso}`,
	name: (key) => (key === "user:lucia" ? "Lucía" : "Paz"),
	person: (key) =>
		key === "user:lucia"
			? { key, name: "Lucía Fernández", imageUrl: null, onRetrospend: true }
			: key === "shadow:paz"
				? { key, name: "Paz Ibarra", imageUrl: null, onRetrospend: false }
				: undefined,
	email: "sofia@example.com",
};

function item(
	type: NeedsYouItem["type"],
	facts: Partial<NeedsYouItem> = {},
): NeedsYouItem {
	return {
		id: `${type}:x`,
		type,
		group: "people",
		entity: null,
		entityIds: [],
		people: [],
		amount: null,
		count: null,
		date: null,
		title: null,
		attention: false,
		actions: [],
		direction: null,
		askAmount: false,
		currencies: [],
		sources: [],
		...facts,
	};
}

describe("toNeedsVM", () => {
	it("a payment to confirm names the person and the day it was paid", () => {
		expect(
			toNeedsVM(
				item("payment.confirm", {
					people: ["user:lucia"],
					amount: ars(2000000),
					date: "2026-10-20",
				}),
				W,
			),
		).toEqual({
			id: "payment.confirm:x",
			kind: "confirmPayment",
			person: "Lucía",
			face: { id: "user:lucia", name: "Lucía Fernández", imageUrl: null },
			amount: ars(2000000),
			context: "paidOn(short 2026-10-20)",
		});
	});

	it("overdue recurring says when it was due; due today needs no context", () => {
		const over = toNeedsVM(
			item("recurring.overdue", {
				title: "Fibra",
				amount: ars(3890000),
				date: "2026-10-08",
			}),
			W,
		);
		expect(over).toMatchObject({
			kind: "overdue",
			title: "Fibra",
			context: "wasDue(short 2026-10-08)",
		});
		const due = toNeedsVM(
			item("recurring.due", { title: "Streamly", amount: ars(1922500) }),
			W,
		);
		expect(due).toMatchObject({ kind: "due", title: "Streamly" });
		expect(due && "context" in due).toBe(false);
	});

	it("an import links to its review, Give it a job carries the pool's figure", () => {
		expect(
			toNeedsVM(
				item("import.review", {
					entity: { kind: "importJob", id: "job1" },
					count: 7,
				}),
				W,
			),
		).toEqual({
			id: "import.review:x",
			kind: "review",
			count: 7,
			href: "/import?job=job1",
		});
		expect(
			toNeedsVM(
				item("budget.giveJob", {
					amount: ars(85000000),
					sources: [
						{
							entryId: "e1",
							kind: "INCOME",
							title: "Salary",
							date: "2026-10-01",
							amount: ars(85000000),
							part: ars(85000000),
						},
					],
				}),
				W,
			),
		).toMatchObject({
			kind: "assign",
			figure: "budget.notPlannedYet",
			href: "/budget",
			context: "arrived(Salary|short 2026-10-01)",
		});
	});

	it("a rejected split takes its action from the server's first action", () => {
		expect(
			toNeedsVM(
				item("split.rejected", {
					people: ["user:lucia"],
					title: "Pizza night",
					amount: ars(1800000),
					actions: [
						{ entity: "expense", id: "edit" },
						{ entity: "expense", id: "correct" },
					],
				}),
				W,
			),
		).toMatchObject({
			kind: "rejected",
			person: "Lucía",
			title: "Pizza night",
			action: "edit",
		});
	});

	it("one envelope over is named; several are counted", () => {
		expect(
			toNeedsVM(
				item("budget.overspent", {
					amount: ars(4840000),
					count: 1,
					title: "Restaurants",
				}),
				W,
			),
		).toMatchObject({ kind: "overspent", envelope: "Restaurants" });
		expect(
			toNeedsVM(
				item("budget.overspent", { amount: ars(8040000), count: 2 }),
				W,
			),
		).toMatchObject({ kind: "overspentMany", count: 2 });
	});

	it("setup prompts: currency links to Settings, email shows the address", () => {
		expect(toNeedsVM(item("setup.homeCurrency"), W)).toEqual({
			id: "setup.homeCurrency:x",
			kind: "homeCurrency",
			context: "homeCurrency",
			href: "/settings#preferences",
		});
		expect(toNeedsVM(item("setup.verifyEmail"), W)).toMatchObject({
			kind: "verifyEmail",
			context: "sofia@example.com",
		});
		expect(toNeedsVM(item("setup.firstExpense"), W)).toMatchObject({
			kind: "firstExpense",
		});
	});

	it("owed for 60 days leads with their face; Remind for people on Retrospend", () => {
		expect(
			toNeedsVM(
				item("people.owedAging", {
					entity: { kind: "person", id: "user:lucia" },
					people: ["user:lucia"],
					amount: ars(5000000),
					date: "2026-08-12",
					actions: [{ entity: "person", id: "remind" }],
				}),
				W,
			),
		).toEqual({
			id: "people.owedAging:x",
			kind: "owedAging",
			person: "Lucía",
			amount: ars(5000000),
			face: { id: "user:lucia", name: "Lucía Fernández", imageUrl: null },
			context: "owedSince(short 2026-08-12)",
			action: "remind",
		});
	});

	it("owed for 60 days by someone not on Retrospend opens their page, with no amount when none is held", () => {
		expect(
			toNeedsVM(
				item("people.owedAging", {
					people: ["shadow:paz"],
					amount: null,
				}),
				W,
			),
		).toEqual({
			id: "people.owedAging:x",
			kind: "owedAging",
			person: "Paz",
			amount: null,
			face: { id: "shadow:paz", name: "Paz Ibarra", imageUrl: null },
			action: "open",
			href: "/people/shadow/paz",
		});
	});

	it("shares that need an envelope count and link to Budget", () => {
		expect(
			toNeedsVM(item("budget.sharesNeedEnvelope", { count: 3 }), W),
		).toEqual({
			id: "budget.sharesNeedEnvelope:x",
			kind: "sharesNeedEnvelope",
			count: 3,
			href: "/budget",
		});
	});

	it("types the kit does not show are left out, the order is the server's", () => {
		const list: NeedsYouList = {
			today: "2026-10-21",
			items: [
				item("budget.missingRate", { currencies: ["BRL"] }),
				item("budget.monthSummary"),
				item("setup.importStatement"),
			],
			counts: { people: 0, activity: 0, budget: 2, setup: 1, total: 3 },
			people: {},
		};
		expect(toNeedsVMs(list, W).map((x) => x.vm.kind)).toEqual([
			"missingRate",
			"importStatement",
		]);
		expect(namedRates(list)).toEqual(["BRL"]);
	});
});
