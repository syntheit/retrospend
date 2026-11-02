import {
	buildTransferWrite,
	newTransferDraft,
	type TransferDraft,
	transferCurrencies,
	transferErrors,
} from "./draftTransfer";
import type { EntryPlace } from "./types";

// The transfer draft and the write it becomes: moves between yen, dinar and
// dollar accounts, what arrived, and the bank fee in the sending currency.

const ID = "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11";
const places: EntryPlace[] = [
	{ id: "yen", name: "Yen", type: "CHECKING", currency: "JPY" },
	{ id: "yen2", name: "Yen cash", type: "CASH", currency: "JPY" },
	{ id: "dinar", name: "Dinar", type: "SAVINGS", currency: "KWD" },
	{ id: "usd", name: "Dollars", type: "CASH", currency: "USD" },
];
const ctx = { locale: "en-US", places };

function draft(over: Partial<TransferDraft> = {}): TransferDraft {
	return {
		...newTransferDraft({
			id: ID,
			date: "2026-11-02",
			currency: "JPY",
			places,
		}),
		amountText: "10,000",
		...over,
	};
}

describe("a new transfer draft", () => {
	it("leaves from an account in your currency to another one", () => {
		expect(
			newTransferDraft({ id: ID, date: "d", currency: "KWD", places }),
		).toMatchObject({ fromId: "dinar", toId: "yen" });
		expect(
			newTransferDraft({ id: ID, date: "d", currency: "JPY", places }),
		).toMatchObject({ fromId: "yen", toId: "yen2" });
	});

	it("takes the first account when none is in your currency", () => {
		expect(
			newTransferDraft({ id: ID, date: "d", currency: "EUR", places }),
		).toMatchObject({ fromId: "yen", toId: "yen2" });
	});

	it("names no account when there are none, or only one", () => {
		expect(
			newTransferDraft({ id: ID, date: "d", currency: "JPY", places: [] }),
		).toMatchObject({ fromId: null, toId: null });
		expect(
			newTransferDraft({
				id: ID,
				date: "d",
				currency: "JPY",
				places: places.slice(0, 1),
			}),
		).toMatchObject({ fromId: "yen", toId: null });
	});
});

describe("transferCurrencies", () => {
	it("reads each side's currency from its account", () => {
		expect(transferCurrencies(draft({ toId: "dinar" }), places)).toEqual({
			from: "JPY",
			to: "KWD",
		});
		expect(transferCurrencies(draft({ fromId: null }), places).from).toBeNull();
	});
});

describe("transferErrors", () => {
	it("needs two accounts, two different ones, and an amount", () => {
		expect(transferErrors(draft({ toId: null }), ctx)).toEqual({
			places: true,
		});
		expect(transferErrors(draft({ toId: "yen" }), ctx)).toEqual({ same: true });
		expect(transferErrors(draft({ amountText: "" }), ctx)).toEqual({
			amount: true,
		});
		expect(transferErrors(draft(), ctx)).toEqual({});
	});

	it("reads the amount in the sending account's decimals", () => {
		expect(transferErrors(draft({ amountText: "10.5" }), ctx).amount).toBe(
			true,
		);
		expect(
			transferErrors(
				draft({ fromId: "dinar", toId: "yen", amountText: "10.5" }),
				ctx,
			),
		).toEqual({});
	});

	it("allows what arrived to be empty, but not unreadable, and only across currencies", () => {
		const exchange = draft({ toId: "dinar" });
		expect(transferErrors({ ...exchange, receivedText: "" }, ctx)).toEqual({});
		expect(transferErrors({ ...exchange, receivedText: "x" }, ctx)).toEqual({
			received: true,
		});
		// KWD has three decimals; JPY none.
		expect(
			transferErrors({ ...exchange, receivedText: "12.345" }, ctx),
		).toEqual({});
		expect(
			transferErrors({ ...exchange, receivedText: "12.3456" }, ctx),
		).toEqual({
			received: true,
		});
		expect(
			transferErrors(draft({ toId: "yen2", receivedText: "x" }), ctx),
		).toEqual({});
	});

	it("reads the fee in the sending account's currency", () => {
		expect(transferErrors(draft({ feeText: "150" }), ctx)).toEqual({});
		expect(transferErrors(draft({ feeText: "1.5" }), ctx)).toEqual({
			fee: true,
		});
		expect(transferErrors(draft({ feeText: "x" }), ctx)).toEqual({ fee: true });
	});
});

describe("buildTransferWrite", () => {
	it("moves yen between two yen accounts with one amount", () => {
		expect(buildTransferWrite(draft(), ctx)).toEqual({
			entity: "transfers",
			label: "Yen > Yen cash",
			body: {
				id: ID,
				fromAccountId: "yen",
				toAccountId: "yen2",
				fromCurrency: "JPY",
				toCurrency: "JPY",
				fromAmount: "10000",
				date: "2026-11-02",
			},
		});
	});

	it("leaves what arrived out of a move in one currency, even if typed", () => {
		const body = buildTransferWrite(
			draft({ receivedText: "9,000" }),
			ctx,
		)?.body;
		expect(body).not.toHaveProperty("toAmount");
	});

	it("is an exchange across currencies: dinars to the thousandth, yen whole", () => {
		const out = buildTransferWrite(
			draft({ toId: "dinar", amountText: "100,000", receivedText: "216.789" }),
			ctx,
		)?.body;
		expect(out).toMatchObject({
			fromCurrency: "JPY",
			toCurrency: "KWD",
			fromAmount: "100000",
			toAmount: "216.789",
		});
		const back = buildTransferWrite(
			draft({
				fromId: "dinar",
				toId: "yen",
				amountText: "216.789",
				receivedText: "100,000",
			}),
			ctx,
		)?.body;
		expect(back).toMatchObject({
			fromAmount: "216.789",
			toAmount: "100000",
		});
	});

	it("leaves the received side to the server's reference rate when empty", () => {
		const body = buildTransferWrite(draft({ toId: "dinar" }), ctx)?.body;
		expect(body).toMatchObject({ fromCurrency: "JPY", toCurrency: "KWD" });
		expect(body).not.toHaveProperty("toAmount");
	});

	it("books the fee in the sending account", () => {
		const body = buildTransferWrite(draft({ feeText: "150" }), ctx)?.body;
		expect(body).toMatchObject({ fee: { amount: "150", accountId: "yen" } });
		const dinars = buildTransferWrite(
			draft({
				fromId: "dinar",
				toId: "yen",
				amountText: "5",
				feeText: "0.250",
			}),
			ctx,
		)?.body;
		expect(dinars).toMatchObject({
			fromAmount: "5.000",
			fee: { amount: "0.250", accountId: "dinar" },
		});
	});

	it("reads amounts in the person's marks", () => {
		const body = buildTransferWrite(
			draft({
				fromId: "dinar",
				toId: "usd",
				amountText: "1.234,567",
				receivedText: "4.000,50",
			}),
			{ ...ctx, locale: "es-AR" },
		)?.body;
		expect(body).toMatchObject({
			fromAmount: "1234.567",
			toAmount: "4000.50",
		});
	});

	it("trims the note and leaves an empty one out", () => {
		expect(
			buildTransferWrite(draft({ note: " rent " }), ctx)?.body,
		).toMatchObject({
			note: "rent",
		});
		expect(
			buildTransferWrite(draft({ note: " " }), ctx)?.body,
		).not.toHaveProperty("note");
	});

	it("is null for any draft that has an error", () => {
		for (const over of [
			{ toId: null },
			{ toId: "yen" },
			{ amountText: "" },
			{ amountText: "0" },
			{ toId: "dinar", receivedText: "x" },
			{ feeText: "x" },
		] satisfies Partial<TransferDraft>[]) {
			expect(buildTransferWrite(draft(over), ctx)).toBeNull();
		}
	});
});
