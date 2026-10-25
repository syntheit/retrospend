import {
	type NeedsYouItem,
	type NeedsYouList,
	needsLine,
	needsTarget,
	visibleNeeds,
} from "./needs";

function item(over: Partial<NeedsYouItem>): NeedsYouItem {
	return {
		id: "x",
		type: "payment.confirm",
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
		...over,
	};
}

const list: NeedsYouList = {
	today: "2026-10-25",
	items: [],
	counts: { people: 0, activity: 0, budget: 0, setup: 0, total: 0 },
	people: {
		"user:lucia": {
			key: "user:lucia",
			name: "Lucía Fernández",
			imageUrl: null,
			onRetrospend: true,
		},
	},
};

describe("needsLine", () => {
	it("words a payment to confirm with the person's first name", () => {
		expect(needsLine(item({ people: ["user:lucia"] }), list)).toMatchObject({
			message: "payment_confirm",
			name: "Lucía",
		});
	});

	it("keeps the title the person typed as is", () => {
		expect(
			needsLine(item({ type: "split.review", title: " Cena  " }), list).title,
		).toBe(" Cena  ");
	});

	it("falls back to a plain line for a type it does not word", () => {
		expect(needsLine(item({ type: "budget.reconcile" }), list).message).toBe(
			"generic",
		);
	});
});

describe("needsTarget", () => {
	it("opens the person for items about a person, and nothing otherwise", () => {
		expect(needsTarget(item({ people: ["user:lucia"] }))).toEqual({
			type: "user",
			id: "lucia",
		});
		expect(
			needsTarget(item({ type: "recurring.due", people: ["user:lucia"] })),
		).toBeNull();
		expect(needsTarget(item({ people: [] }))).toBeNull();
	});
});

describe("visibleNeeds", () => {
	const items = [item({ id: "a" }), item({ id: "b" })];

	it("hides what was put off today and brings it back tomorrow", () => {
		const snoozed = { day: "2026-10-25", ids: ["a"] };
		expect(visibleNeeds(items, snoozed, "2026-10-25")).toEqual({
			shown: [items[1]],
			hidden: 1,
		});
		expect(visibleNeeds(items, snoozed, "2026-10-26").shown).toHaveLength(2);
	});
});
