import { describe, expect, it } from "vitest";
import { loadCatalog } from "@retrospend/i18n/load";
import { SUPPORTED_LOCALES } from "~/i18n/locales";
import { loadCatalogFromDisk } from "./catalog-from-disk";
import { serverTranslator } from "./server-translator";
import {
	buildNoticeText,
	NOTICE_DATA_KEYS,
	type Notice,
	type NoticeData,
	type NoticeKind,
	noticeChanges,
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
		).toBe(
			"Ana split an expense with you, your share is ARS 12,345.50 of ARS 49,382",
		);
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
		).toBe(
			"Ana confirmed your settlement of ARS 12,345.50 across 2 currencies",
		);
		expect(
			await text({
				kind: "squaredUp",
				actor: "Ana",
				amount: { money: jpy, offset: true },
			}),
		).toBe("Ana offset JPY 4,500 across your project balances, no money moved");
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
		expect(
			await text(notice, { language: "en", numberFormat: "dot_comma" }),
		).toBe("Ana rejected your settlement of ARS 12.345,50");
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

	it("never lets a message key reach the text, in English and Spanish, for every variant", async () => {
		const amount = { money: jpy };
		const everything = {
			date: true,
			payer: true,
			split: true,
			category: true,
			project: true,
			other: true,
			amount: { from: jpy, to: jpy },
		};
		for (const language of ["en", "es"])
			for (const kind of KINDS)
				for (const variant of [
					{},
					{ amount, total: jpy },
					{ amount: { ...amount, currencies: 2 } },
					{ amount: { ...amount, offset: true } },
					{ hasLink: true },
					{ changes: everything },
				]) {
					const out = await buildNoticeText(
						{ kind, actor: "Ana", ...variant },
						{ language },
					);
					const label = `${kind} ${language} ${JSON.stringify(variant)}`;
					const all = [out.title, out.body, out.cta, out.changes].join("|");
					expect(all, label).not.toContain("notificationText");
					expect(all, label).not.toMatch(
						new RegExp(`${kind}\\.(title|body|cta)|changes\\.\\w+`),
					);
					expect(all, label).not.toMatch(/\bbody\w*\b|\btitle\b/);
				}
	});

	it("has the catalog namespace, with a title and body for every kind, in every locale", async () => {
		for (const locale of SUPPORTED_LOCALES) {
			const catalog = (await loadCatalog(locale)).notificationText as Record<
				string,
				Record<string, string>
			>;
			expect(catalog, locale).toBeDefined();
			for (const kind of KINDS) {
				expect(catalog[kind]?.title, `${kind} ${locale}`).toBeTruthy();
				expect(catalog[kind]?.body, `${kind} ${locale}`).toBeTruthy();
			}
		}
	});

	it("reads a missing or blank actor as someone", async () => {
		expect(await text({ kind: "periodClosed" })).toBe(
			"Someone closed a period in a project you are in",
		);
		expect(await text({ kind: "addedToProject", actor: "  " })).toBe(
			"Someone added you to a project",
		);
		expect(
			await text({ kind: "addedToProject", actor: null }, { language: "es" }),
		).toBe("Alguien te añadió a un proyecto");
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
		const noLink = await buildNoticeText({
			kind: "projectInvite",
			actor: "Ana",
		});
		expect(noLink.body).toBe("Ana added you to a project on Retrospend");
		expect((await buildNoticeText({ kind: "expenseEdited" })).cta).toBeNull();
	});
});

describe("noticeMoney", () => {
	it("reads a stored amount exactly in the currency's minor units", () => {
		expect(noticeMoney("12345.5", "ARS")).toEqual(ars);
		expect(noticeMoney("4500", "JPY")).toEqual(jpy);
		expect(noticeMoney(12.5, "USD")).toEqual({ minor: 1250, currency: "USD" });
		expect(noticeMoney("20.00", "usd")).toEqual({
			minor: 2000,
			currency: "USD",
		});
	});

	it("is null, never a wrong figure, for what it cannot read", () => {
		expect(noticeMoney(null, "ARS")).toBeNull();
		expect(noticeMoney(undefined, "ARS")).toBeNull();
		expect(noticeMoney("12.345", "USD")).toBeNull();
		expect(noticeMoney("abc", "USD")).toBeNull();
		expect(noticeMoney(Number.NaN, "USD")).toBeNull();
	});
});

describe("buildNoticeText with three-decimal currencies", () => {
	// Hand-derived: KWD has 3 decimals, so 1_250 minor units is KWD 1.250
	// and 12_345_500 is KWD 12,345.500; a 2-decimal read would say 1.25.
	const kwd = { minor: 1_250, currency: "KWD" };

	it("keeps every decimal the currency has", async () => {
		expect(
			await text({
				kind: "expenseDeleted",
				actor: "Ana",
				amount: { money: kwd },
			}),
		).toBe("Ana deleted an expense of KWD 1.250");
		expect(
			await text({
				kind: "settlementReceived",
				actor: "Ana",
				amount: { money: { minor: 12_345_500, currency: "KWD" } },
			}),
		).toBe("Ana sent you a settlement of KWD 12,345.500");
	});

	it("reads a stored KWD amount as 1_250 minor units", () => {
		expect(noticeMoney("1.250", "KWD")).toEqual(kwd);
		expect(noticeMoney("1.2505", "KWD")).toBeNull();
	});
});

describe("what an edit changed", () => {
	const before = { amount: "1000", currency: "ARS" };

	it("says the amount before and after in the formatter, and the kinds that changed", async () => {
		const changes = noticeChanges(["amount", "paidBy", "date"], before, {
			amount: "1500",
			currency: "ARS",
		});
		expect(changes).toEqual({
			amount: {
				from: { minor: 100_000, currency: "ARS" },
				to: { minor: 150_000, currency: "ARS" },
			},
			payer: true,
			date: true,
		});
		const notice: Notice = { kind: "expenseEdited", actor: "Ana", changes };
		expect(plain((await buildNoticeText(notice)).changes ?? "")).toBe(
			"amount: ARS 1,000 to ARS 1,500, date changed, payer changed",
		);
		const es = await buildNoticeText(notice, { language: "es-AR" });
		expect(plain(es.changes ?? "")).toBe(
			"monto: ARS 1.000 a ARS 1.500, fecha modificada, quien pagó modificado",
		);
	});

	it("reads a currency change with the new currency, in JPY and KWD too", () => {
		expect(
			noticeChanges(
				["currency"],
				{ amount: "4500", currency: "JPY" },
				{ amount: "4500", currency: "KWD" },
			),
		).toEqual({
			amount: { from: jpy, to: { minor: 4_500_000, currency: "KWD" } },
		});
	});

	it("never names a title, note or receipt, only that something else changed", async () => {
		const changes = noticeChanges(
			["description", "notes", "receiptUrl"],
			before,
			before,
		);
		expect(changes).toEqual({ other: true });
		const edited = await buildNoticeText({ kind: "expenseEdited", changes });
		expect(edited.changes).toBe("other changes");
		expect(
			(await buildNoticeText({ kind: "expenseEdited" })).changes,
		).toBeNull();
	});
});

describe("the notification data and notice are closed", () => {
	it("has no field a name, title or project name could ride in", () => {
		const probes: unknown[] = [
			// @ts-expect-error a name is not an id
			{ shadowName: "Gil" } satisfies NoticeData,
			// @ts-expect-error a title is not an id
			{ title: "Cena" } satisfies NoticeData,
			// @ts-expect-error a project name is not an id
			{ projectName: "Bariloche" } satisfies NoticeData,
			// @ts-expect-error the notice has no title
			{ kind: "expenseSplit", title: "Cena" } satisfies Notice,
			// @ts-expect-error the notice has no description
			{ kind: "expenseSplit", description: "Cena" } satisfies Notice,
		];
		expect(probes).toHaveLength(5);
	});

	it("lists only ids and codes as the keys a notification may store", () => {
		for (const key of NOTICE_DATA_KEYS)
			expect(key, key).toMatch(/Id$|Ids$|Type$|^kind$/);
	});
});

describe("serverTranslator", () => {
	it("throws on a missing message instead of returning its key", async () => {
		const t = await serverTranslator("en", "notificationText");
		expect(() => t("noSuchKind.title")).toThrow();
		const none = await serverTranslator("en", "noSuchNamespace");
		expect(() => none("a.b")).toThrow();
	});
});

describe("loadCatalogFromDisk", () => {
	it("reads the same catalog the Vite and Turbopack loader does, for every locale", async () => {
		for (const locale of SUPPORTED_LOCALES)
			expect(await loadCatalogFromDisk(locale), locale).toEqual(
				await loadCatalog(locale),
			);
	});
});
