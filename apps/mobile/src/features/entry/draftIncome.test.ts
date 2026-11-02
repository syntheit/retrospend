import {
	buildIncomeWrite,
	type IncomeDraft,
	incomeErrors,
	newIncomeDraft,
} from "./draftIncome";
import type { EntryPlace } from "./types";

// The income draft and the write it becomes: yen and dinars in their own
// decimals, custom and missing rates, the account it lands in and the plan.

const ID = "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11";
const places: EntryPlace[] = [
	{ id: "bank", name: "Bank", type: "CHECKING", currency: "JPY", inBudget: true },
	{ id: "stash", name: "Stash", type: "CASH", currency: "KWD", inBudget: false },
	{ id: "odd", name: "Odd", type: "CASH", currency: "USD" },
];

function draft(over: Partial<IncomeDraft> = {}): IncomeDraft {
	return {
		...newIncomeDraft({
			id: ID,
			currency: "JPY",
			date: "2026-11-02",
			usePlan: false,
		}),
		amountText: "250,000",
		source: "Acme",
		...over,
	};
}
const ctx = { locale: "en-US", hasBudget: false as boolean | null };

describe("a new income draft", () => {
	it("starts empty, in no account, with the default rate", () => {
		expect(
			newIncomeDraft({ id: ID, currency: "KWD", date: "2026-11-02", usePlan: true }),
		).toEqual({
			id: ID,
			currency: "KWD",
			date: "2026-11-02",
			usePlan: true,
			amountText: "",
			source: "",
			note: "",
			categoryId: null,
			into: null,
			repeats: false,
			rateType: null,
			custom: false,
			customText: "",
			customFlipped: false,
			savedRate: null,
			customEdited: false,
		});
	});
});

describe("incomeErrors", () => {
	it("asks for an amount, who paid, and a rate that reads", () => {
		expect(incomeErrors(draft({ amountText: "", source: " " }), "en-US")).toEqual({
			amount: true,
			source: true,
		});
		expect(
			incomeErrors(draft({ custom: true, customText: "" }), "en-US"),
		).toEqual({ rate: true });
		expect(incomeErrors(draft(), "en-US")).toEqual({});
	});

	it("refuses an amount with more decimals than the currency has", () => {
		expect(incomeErrors(draft({ amountText: "10.5" }), "en-US").amount).toBe(true);
		expect(
			incomeErrors(draft({ currency: "KWD", amountText: "10.5" }), "en-US"),
		).toEqual({});
		expect(
			incomeErrors(draft({ currency: "KWD", amountText: "10.5555" }), "en-US")
				.amount,
		).toBe(true);
	});
});

describe("buildIncomeWrite", () => {
	it("writes yen as whole units, titled by who paid", () => {
		expect(buildIncomeWrite(draft(), ctx)).toEqual({
			entity: "income",
			label: "Acme",
			body: {
				id: ID,
				title: "Acme",
				amount: "250000",
				currency: "JPY",
				date: "2026-11-02",
				usePlan: false,
			},
		});
	});

	it("writes dinars to the thousandth", () => {
		const body = buildIncomeWrite(
			draft({ currency: "KWD", amountText: "1,250.5" }),
			ctx,
		)?.body;
		expect(body).toMatchObject({ amount: "1250.500", currency: "KWD" });
	});

	it("reads the amount in the person's marks", () => {
		const body = buildIncomeWrite(
			draft({ currency: "KWD", amountText: "1.250,125" }),
			{ ...ctx, locale: "es-AR" },
		)?.body;
		expect(body).toMatchObject({ amount: "1250.125" });
	});

	it("trims the source and the note, and leaves an empty note out", () => {
		const body = buildIncomeWrite(
			draft({ source: " Acme ", note: " March " }),
			ctx,
		)?.body;
		expect(body).toMatchObject({ title: "Acme", description: "March" });
		expect(buildIncomeWrite(draft({ note: "  " }), ctx)?.body).not.toHaveProperty(
			"description",
		);
	});

	it("is null without an amount, a source or a rate that reads", () => {
		expect(buildIncomeWrite(draft({ amountText: "" }), ctx)).toBeNull();
		expect(buildIncomeWrite(draft({ amountText: "0" }), ctx)).toBeNull();
		expect(buildIncomeWrite(draft({ source: " " }), ctx)).toBeNull();
		for (const customText of ["", "0", "x"]) {
			expect(
				buildIncomeWrite(draft({ custom: true, customText }), ctx),
			).toBeNull();
		}
	});

	describe("the rate", () => {
		it("sends none by default and the picked type when there is one", () => {
			expect(buildIncomeWrite(draft(), ctx)?.body).not.toHaveProperty("rateType");
			expect(
				buildIncomeWrite(draft({ rateType: "official" }), ctx)?.body,
			).toMatchObject({ rateType: "official" });
		});

		it("sends a typed rate in place of the type, never as 1", () => {
			const body = buildIncomeWrite(
				draft({ rateType: "official", custom: true, customText: "0.0067" }),
				ctx,
			)?.body;
			expect(body).toMatchObject({ customRate: "0.0067" });
			expect(body).not.toHaveProperty("rateType");
		});

		it("stores a rate typed the weak way round", () => {
			const body = buildIncomeWrite(
				draft({ custom: true, customText: "4", customFlipped: true }),
				ctx,
			)?.body;
			expect(body).toMatchObject({ customRate: "0.25" });
		});
	});

	describe("the plan", () => {
		it("uses the plan only with an envelope budget", () => {
			const plan = draft({ usePlan: true });
			expect(buildIncomeWrite(plan, { ...ctx, hasBudget: true })?.body).toMatchObject(
				{ usePlan: true },
			);
			expect(buildIncomeWrite(plan, { ...ctx, hasBudget: false })?.body).toMatchObject(
				{ usePlan: false },
			);
			expect(buildIncomeWrite(plan, { ...ctx, hasBudget: null })?.body).toMatchObject(
				{ usePlan: false },
			);
		});

		it("does not use the plan for an account outside the budget", () => {
			const body = (into: string) =>
				buildIncomeWrite(draft({ usePlan: true, into }), {
					...ctx,
					hasBudget: true,
					places,
				})?.body;
			expect(body("bank")).toMatchObject({ into: "bank", keep: false, usePlan: true });
			expect(body("stash")).toMatchObject({ into: "stash", keep: true, usePlan: false });
		});

		it("sends keep only when the account's budget side is known", () => {
			const body = buildIncomeWrite(draft({ into: "odd" }), {
				...ctx,
				places,
			})?.body;
			expect(body).toMatchObject({ into: "odd" });
			expect(body).not.toHaveProperty("keep");
		});
	});

	it("files under a category and repeats monthly when asked", () => {
		const body = buildIncomeWrite(
			draft({ categoryId: "salary", repeats: true }),
			ctx,
		)?.body;
		expect(body).toMatchObject({
			categoryId: "salary",
			repeats: { frequency: "MONTHLY" },
		});
		expect(buildIncomeWrite(draft(), ctx)?.body).not.toHaveProperty("repeats");
	});
});
