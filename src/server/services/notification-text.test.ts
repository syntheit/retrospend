import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "~/i18n/locales";
import {
	buildNoticeText,
	type Notice,
	type NoticeKind,
	noticeMoney,
} from "./notification-text";

/** The money formatter joins the code and the number with a no-break space. */
const plain = (text: string) => text.replaceAll(" ", " ");
const text = async (notice: Notice, reader = {}) =>
	plain((await buildNoticeText(notice, reader)).body);

// Hand-derived: ARS 12,345.50 is 1_234_550 minor units (2 decimals), and
// JPY has none, so 4_500 minor is JPY 4,500.
const ars = { minor: 1_234_550, currency: "ARS" };
const arsTotal = { minor: 4_938_200, currency: "ARS" };
const jpy = { minor: 4_500, currency: "JPY" };

const KINDS: NoticeKind[] = [
	"expenseSplit",
	"expenseEdited",
	"expenseDeleted",
	"paymentRecordedByPayee",
	"settlementReceived",
	"settlementConfirmed",
	"settlementRejected",
	"settlementReminder",
	"balanceReminder",
	"squaredUp",
	"periodClosed",
	"addedToProject",
	"ownershipTransferred",
	"profileClaimed",
	"fixRequested",
	"fixAccepted",
	"fixDeclined",
	"splitCorrected",
	"projectInvite",
	"guestResume",
];

describe("buildNoticeText amounts", () => {
	it("names a share and the total in ARS through the money formatter", async () => {
		expect(
			await text({
				kind: "expenseSplit",
				actor: "Ana",
				amount: { money: ars },
				total: arsTotal,
			}),
		).toBe("Ana split an expense with you, your share is ARS 12,345.50 of ARS 49,382");
	});

	it("names a JPY amount with no decimals", async () => {
		expect(
			await text({
				kind: "expenseDeleted",
				actor: "Ben",
				amount: { money: jpy },
			}),
		).toBe("Ben deleted an expense of JPY 4,500");
		expect(
			await text({
				kind: "settlementReceived",
				actor: "Ben",
				amount: { money: jpy },
			}),
		).toBe("Ben sent you a settlement of JPY 4,500");
	});

	it("words a payment across currencies and an offset", async () => {
		expect(
			await text({
				kind: "settlementConfirmed",
				actor: "Ana",
				amount: { money: ars, currencies: 2 },
			}),
		).toBe("Ana confirmed your settlement of ARS 12,345.50 across 2 currencies");
		expect(
			await text({
				kind: "squaredUp",
				actor: "Ana",
				amount: { money: jpy, offset: true },
			}),
		).toBe(
			"Ana offset JPY 4,500 across your project balances, no money moved",
		);
	});

	it("reads the amount in the reader's language and number format", async () => {
		const notice: Notice = {
			kind: "settlementRejected",
			actor: "Ana",
			amount: { money: ars },
		};
		expect(await text(notice, { language: "es-AR" })).toBe(
			"Ana rechazó tu liquidación de ARS 12.345,50",
		);
		expect(await text(notice, { language: "en", numberFormat: "dot_comma" })).toBe(
			"Ana rejected your settlement of ARS 12.345,50",
		);
		expect(await text(notice, { language: "de" })).toContain("ARS 12.345,50");
	});

	it("names no amount when there is none", async () => {
		expect(await text({ kind: "expenseDeleted", actor: "Ana" })).toBe(
			"Ana deleted an expense you share",
		);
	});
});

describe("buildNoticeText never carries free text", () => {
	it("ignores a title, description, project name or note put on the notice", async () => {
		const smuggled = {
			kind: "expenseSplit",
			actor: "Ana",
			amount: { money: ars },
			title: "Cena en Chez Nous 7421",
			description: "Cena en Chez Nous 7421",
			projectName: "Viaje a Bariloche",
			periodLabel: "Marzo",
			notes: "SECRET NOTE",
		} as unknown as Notice;
		const { title, body } = await buildNoticeText(smuggled);
		const all = JSON.stringify([title, body]);
		for (const word of ["Chez", "Bariloche", "Marzo", "SECRET"])
			expect(all).not.toContain(word);
	});

	it("words every kind in every language from the actor alone", async () => {
		for (const language of SUPPORTED_LOCALES)
			for (const kind of KINDS) {
				const out = await buildNoticeText(
					{ kind, actor: "Ana", amount: { money: jpy } },
					{ language },
				);
				const label = `${kind} ${language}`;
				expect(out.title, label).not.toBe("");
				expect(out.body, label).not.toMatch(/[{}]|undefined|notificationText/);
				expect(out.body, label).not.toContain(String.fromCharCode(0x2014));
			}
	});

	it("reads a missing or blank actor as someone", async () => {
		expect(await text({ kind: "periodClosed" })).toBe(
			"Someone closed a period in a project you are in",
		);
		expect(await text({ kind: "addedToProject", actor: "  " })).toBe(
			"Someone added you to a project",
		);
		expect(await text({ kind: "addedToProject", actor: null }, { language: "es" })).toBe(
			"Alguien te añadió a un proyecto",
		);
	});

	it("gives an email its button label and says what the link leads to", async () => {
		const invite = await buildNoticeText({
			kind: "projectInvite",
			actor: "Ana",
			hasLink: true,
		});
		expect(invite.cta).toBe("Join project");
		expect(invite.body).toBe(
			"Ana added you to a project on Retrospend. Join to see the shared expenses.",
		);
		const noLink = await buildNoticeText({ kind: "projectInvite", actor: "Ana" });
		expect(noLink.body).toBe("Ana added you to a project on Retrospend");
		expect((await buildNoticeText({ kind: "expenseEdited" })).cta).toBeNull();
	});
});

describe("noticeMoney", () => {
	it("reads a stored amount exactly in the currency's minor units", () => {
		expect(noticeMoney("12345.5", "ARS")).toEqual(ars);
		expect(noticeMoney("4500", "JPY")).toEqual(jpy);
		expect(noticeMoney(12.5, "USD")).toEqual({ minor: 1250, currency: "USD" });
		expect(noticeMoney("20.00", "usd")).toEqual({ minor: 2000, currency: "USD" });
	});

	it("is null, never a wrong figure, for what it cannot read", () => {
		expect(noticeMoney(null, "ARS")).toBeNull();
		expect(noticeMoney(undefined, "ARS")).toBeNull();
		expect(noticeMoney("12.345", "USD")).toBeNull();
		expect(noticeMoney("abc", "USD")).toBeNull();
		expect(noticeMoney(Number.NaN, "USD")).toBeNull();
	});
});
