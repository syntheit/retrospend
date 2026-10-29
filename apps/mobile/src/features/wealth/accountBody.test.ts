import {
	type AccountForm,
	aprInvalid,
	createBody,
	dueDayOf,
	emptyForm,
	formProblem,
	updateBody,
} from "./accountBody";

function form(over: Partial<AccountForm> = {}): AccountForm {
	return { ...emptyForm("USD"), name: "Savings", minor: 123456, ...over };
}

describe("account body", () => {
	it("writes the balance as decimal text of the keypad's minor units", () => {
		expect(createBody(form(), "id-1")).toEqual({
			id: "id-1",
			name: "Savings",
			type: "CASH",
			currency: "USD",
			balance: "1234.56",
			rateType: null,
			isLiquid: true,
			interestRate: null,
			minimumPayment: null,
			dueDay: null,
		});
	});

	it("writes zero as a real balance and keeps the currency's decimals", () => {
		expect(createBody(form({ minor: 0, currency: "JPY" }), "x")?.balance).toBe(
			"0",
		);
		expect(
			createBody(form({ minor: 500, currency: "JPY" }), "x")?.balance,
		).toBe("500");
	});

	it("needs a name and a balance", () => {
		expect(formProblem(form({ name: "  " }))).toBe("name");
		expect(formProblem(form({ minor: null }))).toBe("balance");
		expect(createBody(form({ name: "" }), "x")).toBeNull();
	});

	it("keeps liability terms for debts only, and a debt is never liquid", () => {
		const debt = form({
			type: "LIABILITY_CREDIT_CARD",
			apr: "24,5%",
			dueDay: "15",
			minimumMinor: 2500,
			liquid: true,
		});
		expect(createBody(debt, "x")).toMatchObject({
			isLiquid: false,
			interestRate: "24.5",
			dueDay: 15,
			minimumPayment: "25.00",
		});
		expect(
			createBody(form({ apr: "9", dueDay: "3", minimumMinor: 100 }), "x"),
		).toMatchObject({ interestRate: null, dueDay: null, minimumPayment: null });
	});

	it("rejects a rate or due day the server would", () => {
		expect(aprInvalid("abc")).toBe(true);
		expect(aprInvalid("")).toBe(false);
		expect(aprInvalid("45.5")).toBe(false);
		expect(dueDayOf("31")).toBe(31);
		expect(dueDayOf("32")).toBeNull();
		expect(formProblem(form({ type: "LIABILITY_LOAN", dueDay: "40" }))).toBe(
			"dueDay",
		);
	});

	it("blocks Save on a minimum payment that is not an amount, so it never clears the stored one", () => {
		const debt = form({
			type: "LIABILITY_LOAN",
			minimumMinor: null,
			minimumInvalid: true,
		});
		expect(formProblem(debt)).toBe("minimum");
		expect(updateBody(debt, "acc_1")).toBeNull();
		expect(
			updateBody({ ...debt, minimumInvalid: false }, "acc_1"),
		).toMatchObject({ minimumPayment: null });
	});

	it("carries the id and the kept in-budget choice on an edit", () => {
		expect(updateBody(form({ inBudget: false }), "acc_1")).toMatchObject({
			id: "acc_1",
			inBudget: false,
		});
	});
});
