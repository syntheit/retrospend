import type { NeedsItem } from "@/features/people/source";
import { categoriesOf, filterExpenses, payers, projectNeeds } from "./filters";
import type { ProjectExpense } from "./source";

const expense = (
	id: string,
	payerName: string | null,
	waiting: ProjectExpense["waiting"] = null,
): ProjectExpense =>
	({ id, payerName, payerIsMe: payerName === null, waiting }) as ProjectExpense;

const list = [
	expense("a", "Valentina", "review"),
	expense("b", null),
	expense("c", "Martín"),
	expense("d", "Valentina"),
];

describe("filterExpenses", () => {
	it("keeps everything with no chip on", () => {
		expect(
			filterExpenses(list, { toReview: false, paidBy: null }),
		).toHaveLength(4);
	});
	it("keeps only the ones to review", () => {
		expect(
			filterExpenses(list, { toReview: true, paidBy: null }).map((e) => e.id),
		).toEqual(["a"]);
	});
	it("keeps one payer's, you included", () => {
		expect(
			filterExpenses(list, { toReview: false, paidBy: "Valentina" }).map(
				(e) => e.id,
			),
		).toEqual(["a", "d"]);
		expect(
			filterExpenses(list, { toReview: false, paidBy: "me" }).map((e) => e.id),
		).toEqual(["b"]);
	});
});

describe("categories", () => {
	const withCategory = (id: string, category: string | null) =>
		({
			id,
			category: category
				? { id: category, name: category.toUpperCase() }
				: null,
		}) as ProjectExpense;
	const rows = [
		withCategory("a", "food"),
		withCategory("b", "stay"),
		withCategory("c", "food"),
		withCategory("d", null),
	];

	it("lists each category once, in order", () => {
		expect(categoriesOf(rows)).toEqual([
			{ id: "food", name: "FOOD" },
			{ id: "stay", name: "STAY" },
		]);
	});

	it("keeps one category's expenses", () => {
		expect(
			filterExpenses(rows, {
				toReview: false,
				paidBy: null,
				category: "food",
			}).map((e) => e.id),
		).toEqual(["a", "c"]);
	});
});

describe("payers", () => {
	it("lists each payer once, you first", () => {
		expect(payers(list)).toEqual(["me", "Valentina", "Martín"]);
	});
});

describe("projectNeeds", () => {
	const verify = (id: string) => ({ kind: "verify", id }) as NeedsItem;
	const pay = { kind: "confirmPayment", id: "a" } as NeedsItem;
	it("keeps the reviews of this project's expenses only", () => {
		expect(
			projectNeeds([verify("a"), verify("zzz"), pay], list).map((n) => n.id),
		).toEqual(["a"]);
	});
});
