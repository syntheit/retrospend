import {
	budgetCurrencyOf,
	budgetInvalid,
	canArchiveProject,
	canEditProject,
	createBody,
	emptyForm,
	NAME_MAX,
	type ProjectOriginal,
	updateBody,
} from "./projectForm";

const L = "en-US";
const ID = "0b9a2c1e-0000-4000-8000-000000000001";

const form = (patch: Partial<ReturnType<typeof emptyForm>> = {}) => ({
	...emptyForm("USD"),
	...patch,
});

const original = (patch: Partial<ProjectOriginal> = {}): ProjectOriginal => ({
	id: "p1",
	name: "Lisbon",
	primaryCurrency: "EUR",
	budget: null,
	...patch,
});

describe("who may do what", () => {
	it("lets Owners and Editors edit, and only Owners archive", () => {
		expect(canEditProject("ORGANIZER")).toBe(true);
		expect(canEditProject("EDITOR")).toBe(true);
		expect(canEditProject("CONTRIBUTOR")).toBe(false);
		expect(canEditProject("VIEWER")).toBe(false);
		expect(canEditProject(null)).toBe(false);
		expect(canArchiveProject("ORGANIZER")).toBe(true);
		expect(canArchiveProject("EDITOR")).toBe(false);
		expect(canArchiveProject(null)).toBe(false);
	});
});

describe("createBody", () => {
	it("is not ready without a name", () => {
		expect(createBody(form(), ID, L)).toBeNull();
		expect(createBody(form({ name: "   " }), ID, L)).toBeNull();
	});

	it("is not ready with a name past the limit", () => {
		expect(
			createBody(form({ name: "x".repeat(NAME_MAX + 1) }), ID, L),
		).toBeNull();
	});

	it("sends the id, the trimmed name and the currency, with no budget", () => {
		expect(createBody(form({ name: "  Lisbon " }), ID, L)).toEqual({
			id: ID,
			name: "Lisbon",
			primaryCurrency: "USD",
		});
	});

	it("sends a typed budget as decimal text in the project currency", () => {
		expect(
			createBody(
				form({ name: "Lisbon", currency: "EUR", budget: "1,200.5" }),
				ID,
				L,
			),
		).toEqual({
			id: ID,
			name: "Lisbon",
			primaryCurrency: "EUR",
			budgetAmount: "1200.50",
			budgetCurrency: "EUR",
		});
	});

	it("is not ready while the budget is zero or unreadable", () => {
		expect(createBody(form({ name: "Lisbon", budget: "0" }), ID, L)).toBeNull();
		expect(
			createBody(form({ name: "Lisbon", budget: "abc" }), ID, L),
		).toBeNull();
	});
});

describe("budgetInvalid", () => {
	it("is false for no budget and a real one", () => {
		expect(budgetInvalid(form(), null, L)).toBe(false);
		expect(budgetInvalid(form({ budget: "50" }), null, L)).toBe(false);
	});

	it("is true for zero", () => {
		expect(budgetInvalid(form({ budget: "0" }), null, L)).toBe(true);
	});
});

describe("updateBody", () => {
	const same = (patch = {}) =>
		form({ name: "Lisbon", currency: "EUR", ...patch });

	it("is null while nothing changed", () => {
		expect(updateBody(same(), original(), L)).toBeNull();
	});

	it("sends only the name when only the name changed", () => {
		expect(updateBody(same({ name: " Porto " }), original(), L)).toEqual({
			id: "p1",
			name: "Porto",
		});
	});

	it("sends only the currency when only the currency changed", () => {
		expect(updateBody(same({ currency: "USD" }), original(), L)).toEqual({
			id: "p1",
			primaryCurrency: "USD",
		});
	});

	it("is null with an empty name", () => {
		expect(updateBody(same({ name: "" }), original(), L)).toBeNull();
	});

	it("sets a new budget with its currency", () => {
		expect(updateBody(same({ budget: "300" }), original(), L)).toEqual({
			id: "p1",
			budgetAmount: "300.00",
			budgetCurrency: "EUR",
		});
	});

	it("leaves an unchanged budget out", () => {
		const withBudget = original({
			budget: { amount: { minor: 30_000, currency: "EUR" } },
		});
		expect(updateBody(same({ budget: "300.00" }), withBudget, L)).toBeNull();
	});

	it("clears the budget when the field is emptied", () => {
		const withBudget = original({
			budget: { amount: { minor: 30_000, currency: "EUR" } },
		});
		expect(updateBody(same({ budget: "" }), withBudget, L)).toEqual({
			id: "p1",
			budgetAmount: null,
		});
	});

	it("keeps a budget set in another currency in that currency", () => {
		const usdBudget = original({
			budget: { amount: { minor: 10_000, currency: "USD" } },
		});
		expect(budgetCurrencyOf(same(), usdBudget)).toBe("USD");
		expect(updateBody(same({ budget: "250" }), usdBudget, L)).toEqual({
			id: "p1",
			budgetAmount: "250.00",
			budgetCurrency: "USD",
		});
	});

	it("is null while the budget is zero", () => {
		expect(updateBody(same({ budget: "0" }), original(), L)).toBeNull();
	});
});
