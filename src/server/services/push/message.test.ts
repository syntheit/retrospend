import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "~/i18n/locales";
import { PUSH_KINDS, type PushKind } from "./kinds";
import { buildPushMessage, newPushData, parsePushData } from "./message";

const KINDS = Object.keys(PUSH_KINDS) as PushKind[];
const usd = { minor: 1250, currency: "USD" };
/** The money formatter joins the code and the number with a no-break space. */
const plain = (text: string) => text.replaceAll("\u00a0", " ");

describe("buildPushMessage", () => {
	it("keeps the account's number format over the language", async () => {
		const data = newPushData("payment.recorded", { amount: usd });
		expect(
			plain((await buildPushMessage(data, "de", "comma_dot")).body),
		).toBe("Eine Zahlung über USD 12.50 wurde erfasst");
		expect(
			plain((await buildPushMessage(data, "en", "dot_comma")).body),
		).toBe("A payment of USD 12,50 was recorded");
	});

	it("words every kind in every language, with the amount when it has one", async () => {
		for (const locale of SUPPORTED_LOCALES)
			for (const type of KINDS) {
				const data = newPushData(type, {
					entity: { type: "thing", id: "abc" },
					amount: type === "fix_request.created" ? null : usd,
				});
				const message = await buildPushMessage(data, locale);
				const text = `${message.title} | ${message.body}`;
				expect(message.title, text).not.toBe("");
				expect(text, `${type} ${locale}`).not.toMatch(/[{}]|undefined|push\./);
				if (data.amount)
					expect(message.body, `${type} ${locale}`).toContain("12");
			}
	});

	it("formats the amount in the reader's language", async () => {
		const data = newPushData("payment.recorded", { amount: usd });
		expect(plain((await buildPushMessage(data, "en")).body)).toBe(
			"A payment of USD 12.50 was recorded",
		);
		expect(plain((await buildPushMessage(data, "de")).body)).toBe(
			"Eine Zahlung über USD 12,50 wurde erfasst",
		);
		expect((await buildPushMessage(data, "es-AR")).title).toBe(
			"Pago registrado",
		);
	});

	it("uses the informal address in German and French", async () => {
		const data = newPushData("payment.confirmed", { amount: usd });
		expect((await buildPushMessage(data, "de")).body).toContain("Deine");
		expect((await buildPushMessage(data, "fr")).body).toContain("Ton");
	});

	it("falls back to English for a language it does not have", async () => {
		const data = newPushData("payment.recorded");
		for (const language of ["xx", "", null, undefined])
			expect((await buildPushMessage(data, language)).title).toBe(
				"Payment recorded",
			);
	});

	it("leaves the amount out when the figure is not known", async () => {
		const out = newPushData("recurring.due", { direction: "out" });
		expect((await buildPushMessage(out, "en")).body).toBe(
			"A recurring expense is due",
		);
		const income = newPushData("recurring.due", {
			direction: "in",
			amount: { minor: 500000, currency: "ARS" },
		});
		const message = await buildPushMessage(income, "en");
		expect(message.title).toBe("Recurring income due");
		expect(plain(message.body)).toBe("ARS 5,000 is due");
	});

	it("carries ids and the amount for the app, and the channel", async () => {
		const data = newPushData("shared_expense.created", {
			entity: { type: "shared_expense", id: "tx1" },
			amount: usd,
		});
		const message = await buildPushMessage(data, "en");
		expect(message.channel).toBe("splits");
		expect(message.data).toEqual({
			v: 1,
			type: "shared_expense.created",
			channel: "splits",
			entity: { type: "shared_expense", id: "tx1" },
			ids: {},
			amount: usd,
		});
	});
});

describe("parsePushData", () => {
	it("reads back what newPushData wrote", () => {
		const data = newPushData("fix_request.created", {
			entity: { type: "fix_request", id: "fr1" },
			ids: { transactionId: "tx1" },
		});
		expect(parsePushData(JSON.parse(JSON.stringify(data)))).toEqual(data);
	});

	it("refuses what it did not write and drops ids that are not ids", () => {
		expect(parsePushData(null)).toBeNull();
		expect(parsePushData({ v: 2, type: "payment.recorded" })).toBeNull();
		expect(parsePushData({ v: 1, type: "expense.created" })).toBeNull();
		expect(parsePushData({ v: 1, type: "constructor" })).toBeNull();
		const parsed = parsePushData({
			v: 1,
			type: "payment.recorded",
			entity: { type: "payment", id: "Dinner at Chez Nous" },
			ids: { good: "abc", bad: "Some title with spaces" },
			amount: { minor: 1.5, currency: "USD" },
		});
		expect(parsed).toMatchObject({
			entity: null,
			ids: { good: "abc" },
			amount: null,
		});
	});
});
