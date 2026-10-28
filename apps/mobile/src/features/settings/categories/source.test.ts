import {
	type Category,
	changesOf,
	draftOf,
	draftValid,
	nameTaken,
} from "./source";

const food: Category = {
	id: "c1",
	name: "Food",
	color: "emerald",
	icon: null,
	tone: 1,
	excludeByDefault: false,
	expenseCount: 3,
};

describe("category draft", () => {
	it("starts from the category, or a teal blank for a new one", () => {
		expect(draftOf(food)).toEqual({
			name: "Food",
			color: "emerald",
			icon: null,
			excludeByDefault: false,
		});
		expect(draftOf(null).color).toBe("teal");
	});

	it("needs a name of 1 to 64 characters", () => {
		expect(draftValid({ ...draftOf(null), name: "  " })).toBe(false);
		expect(draftValid({ ...draftOf(null), name: "Rent" })).toBe(true);
		expect(draftValid({ ...draftOf(null), name: "x".repeat(65) })).toBe(false);
	});

	it("sends only what changed", () => {
		expect(changesOf(draftOf(food), food)).toEqual({});
		expect(
			changesOf(
				{ ...draftOf(food), name: " Groceries ", icon: "ShoppingBasket" },
				food,
			),
		).toEqual({ name: "Groceries", icon: "ShoppingBasket" });
	});

	it("spots a name already in use, ignoring case and the category itself", () => {
		const draft = { ...draftOf(null), name: "food" };
		expect(nameTaken(draft, [food], null)).toBe(true);
		expect(nameTaken(draft, [food], "c1")).toBe(false);
	});
});
