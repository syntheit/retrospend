import {
	type NeedsYouItem,
	type NeedsYouList,
	needsAction,
	needsContext,
	needsDestination,
	needsGlyph,
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

describe("needsDestination", () => {
	it("opens the person for the items about one", () => {
		expect(needsDestination(item({ people: ["user:lucia"] }))).toEqual({
			kind: "person",
			ref: { type: "user", id: "lucia" },
		});
		expect(needsDestination(item({ people: [] }))).toEqual({ kind: "people" });
	});

	it("gives every other kind a place to go", () => {
		const where = (type: NeedsYouItem["type"]) =>
			needsDestination(item({ type })).kind;
		expect(where("recurring.overdue")).toBe("recurring");
		expect(where("recurring.due")).toBe("recurring");
		expect(where("import.review")).toBe("activity");
		expect(where("budget.missingRate")).toBe("currencies");
		expect(where("setup.firstExpense")).toBe("add");
		expect(where("setup.homeCurrency")).toBe("settings");
		expect(where("setup.verifyEmail")).toBe("settings");
		for (const type of [
			"budget.giveJob",
			"budget.overAssigned",
			"budget.overspent",
			"budget.billDue",
			"budget.debtDue",
			"budget.sharesNeedEnvelope",
			"budget.monthSummary",
			"budget.monthChanged",
			"budget.startingMoney",
			"budget.hiddenReview",
			"budget.reconcile",
		] as const) {
			expect(where(type)).toBe("budget");
		}
	});
});

describe("needs words and tiles", () => {
	it("words the budget kinds the web words", () => {
		expect(needsLine(item({ type: "budget.overAssigned" }), list).message).toBe(
			"budget_overAssigned",
		);
		expect(needsLine(item({ type: "budget.billDue" }), list).message).toBe(
			"budget_billDue",
		);
	});

	it("picks one action word and one glyph per kind", () => {
		expect(needsAction(item({ type: "budget.overspent" }))).toBe("cover");
		expect(needsAction(item({ type: "budget.monthSummary" }))).toBe("open");
		expect(needsGlyph(item({ type: "recurring.overdue" }))).toBe("AlarmClock");
	});

	it("gives a recurring item the day it is due or was due", () => {
		expect(
			needsContext(item({ type: "recurring.overdue", date: "2026-10-08" })),
		).toEqual({ key: "wasDue", day: "2026-10-08" });
		expect(
			needsContext(item({ type: "recurring.due", date: "2026-10-25" })),
		).toEqual({ key: "dueOn", day: "2026-10-25" });
		expect(
			needsContext(item({ type: "recurring.due", date: null })),
		).toBeNull();
		expect(
			needsContext(item({ type: "payment.confirm", date: "2026-10-08" })),
		).toBeNull();
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

	it("leaves out what can only be done on the web", () => {
		const web = [
			item({ id: "i", type: "setup.importStatement" }),
			item({ id: "r", type: "import.review" }),
			item({ id: "p" }),
		];
		expect(visibleNeeds(web, null, "2026-10-25")).toEqual({
			shown: [web[2]],
			hidden: 0,
		});
	});
});
