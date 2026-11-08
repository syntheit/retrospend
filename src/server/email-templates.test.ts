import { readFileSync } from "node:fs";
import tokens from "@retrospend/tokens/tokens.json";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/env", () => ({
	env: {
		PUBLIC_URL: "https://retro.example",
		NEXT_PUBLIC_APP_URL: "",
	},
}));

import notificationCatalog from "../../packages/i18n/messages/en/notificationText.json";
import { SUPPORTED_LOCALES } from "~/i18n/locales";
import { emailSubject } from "./email-copy";
import {
	getEmailChangeAlertTemplate,
	getEmailChangeVerificationTemplate,
	getFeedbackNotificationTemplate,
	getPasswordChangedAlertTemplate,
	getPasswordResetEmailTemplate,
	getShadowInviteEmailTemplate,
	getTestEmailTemplate,
	getVerificationEmailTemplate,
	notificationEmail,
} from "./email-templates";
import {
	buildEmailLabels,
	buildNoticeText,
	type NoticeKind,
} from "./services/notification-text";

const EM_DASH = String.fromCharCode(0x2014);
const URL_IN = "https://retro.example/auth/x?token=abc&b=1";
const HEX = /#[0-9a-f]{6}(?:[0-9a-f]{2})?\b/gi;
const tokenValues = new Set(
	Object.values(tokens.light)
		.filter((value): value is string => typeof value === "string")
		.map((value) => value.toLowerCase()),
);

const labels = {
	view: "Open Retrospend",
	manage: "Settings",
	unsubscribe: "Stop",
};

// Every template with the subject it is sent under and the link its button
// carries. A subject and the page <title> are the same words.
const cases: { name: string; subject: string; html: string; link: string }[] = [
	{
		name: "verify email",
		subject: emailSubject.verifyEmail,
		html: getVerificationEmailTemplate(URL_IN),
		link: URL_IN,
	},
	{
		name: "password reset",
		subject: emailSubject.passwordReset,
		html: getPasswordResetEmailTemplate(URL_IN),
		link: URL_IN,
	},
	{
		name: "password changed",
		subject: emailSubject.passwordChanged,
		html: getPasswordChangedAlertTemplate(),
		link: "",
	},
	{
		name: "email change confirm",
		subject: emailSubject.emailChangeConfirm,
		html: getEmailChangeVerificationTemplate(URL_IN, "new@example.test"),
		link: URL_IN,
	},
	{
		name: "email change alert",
		subject: emailSubject.emailChangeAlert,
		html: getEmailChangeAlertTemplate(URL_IN, "new@example.test"),
		link: URL_IN,
	},
	{
		name: "feedback",
		subject: emailSubject.feedback("Sofia"),
		html: getFeedbackNotificationTemplate(
			"Sofia",
			"Great <app>",
			"/home",
			"Nov 8",
		),
		link: "https://retro.example/admin",
	},
	{
		name: "shadow invite",
		subject: emailSubject.shadowInvite("Sofia"),
		html: getShadowInviteEmailTemplate("Sofia", URL_IN),
		link: URL_IN,
	},
	{
		name: "smtp test",
		subject: emailSubject.smtpTest,
		html: getTestEmailTemplate(),
		link: "",
	},
	{
		name: "notice (project invite)",
		subject: emailSubject.notification("Added to project"),
		html: notificationEmail({
			title: "Added to project",
			body: "Sofia added you to a project on Retrospend",
			labels,
			ctaUrl: URL_IN,
			ctaLabel: "Join project",
			unsubscribeUrl: "https://retro.example/unsubscribe?t=1",
		}),
		link: URL_IN,
	},
];

const escaped = (value: string) => value.replaceAll("&", "&amp;");

// A word that starts with a capital after the first is Title Case, unless it
// is a name the email carries or a proper noun.
function isSentenceCase(subject: string) {
	const words = subject.replace(/^Retrospend: /, "").split(" ");
	return words
		.slice(1)
		.every((word) => !/^[A-Z][a-z]/.test(word) || word === "Retrospend");
}

describe("email templates", () => {
	for (const c of cases) {
		describe(c.name, () => {
			it("uses only token colors and has no raw literal", () => {
				const found = c.html.match(HEX) ?? [];
				expect(found.length).toBeGreaterThan(0);
				for (const hex of found)
					expect(tokenValues).toContain(hex.toLowerCase());
				expect(c.html).not.toMatch(/rgba?\(|hsl|oklch/i);
			});

			it("takes its page title from the subject, in sentence case", () => {
				expect(c.html).toContain(`<title>${escaped(c.subject)}</title>`);
				expect(isSentenceCase(c.subject.replaceAll("Sofia", "someone"))).toBe(
					true,
				);
			});

			it("has the button link and no em dash", () => {
				if (c.link) expect(c.html).toContain(`href="${escaped(c.link)}"`);
				expect(c.html).not.toContain(EM_DASH);
				expect(c.html).not.toMatch(/box-shadow|gradient|text-transform/);
			});

			it("shows no raw catalog key", () => {
				expect(c.html).not.toMatch(/notificationText|\bemail\.(view|manage)\b/);
				expect(c.subject).not.toMatch(/notificationText|undefined/);
			});
		});
	}

	it("escapes what a person typed", () => {
		const html = cases.find((c) => c.name === "feedback")?.html ?? "";
		expect(html).toContain("Great &lt;app&gt;");
		expect(html).not.toContain("<app>");
	});

	it("says Sign in words from the glossary, never log in", () => {
		for (const c of cases) expect(c.html).not.toMatch(/log ?in/i);
	});
});

describe("the three source files", () => {
	for (const file of ["email-templates.ts", "email-copy.ts"]) {
		it(`${file} holds no color literal and no em dash`, () => {
			const source = readFileSync(
				new URL(`./${file}`, import.meta.url),
				"utf8",
			);
			expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
			expect(source).not.toMatch(/rgba?\(|hsl\(|oklch\(/);
			expect(source).not.toContain(EM_DASH);
		});
	}

	it("email-theme.ts reads every color from the tokens", () => {
		const source = readFileSync(
			new URL("./email-theme.ts", import.meta.url),
			"utf8",
		);
		expect(source).toContain("@retrospend/tokens/tokens.json");
		expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
	});
});

describe("notice emails in every language", () => {
	const kinds = Object.keys(notificationCatalog).filter(
		(key) => !["actorUnknown", "changes", "email"].includes(key),
	) as NoticeKind[];

	it("covers each kind the catalog has", () => {
		expect(kinds.length).toBeGreaterThan(15);
	});

	for (const locale of SUPPORTED_LOCALES) {
		it(`${locale}: every subject and button reads as words`, async () => {
			const reader = { language: locale };
			const chrome = await buildEmailLabels(reader);
			expect(chrome.locale).toBe(locale);
			for (const kind of kinds) {
				const text = await buildNoticeText(
					{ kind, actor: "Sofia", hasLink: true },
					reader,
				);
				const subject = emailSubject.notification(text.title);
				const { locale: lang, ...rest } = chrome;
				const html = notificationEmail({
					title: text.title,
					body: text.body,
					labels: rest,
					locale: lang,
					ctaUrl: URL_IN,
					ctaLabel: text.cta ?? undefined,
				});
				for (const value of [subject, text.title, text.body, text.cta ?? ""])
					expect(value).not.toMatch(/notificationText|^[a-zA-Z]+\.[a-zA-Z.]+$/);
				expect(html).toContain(`<html lang="${locale}">`);
				expect(html).toContain(`>${escaped(rest.manage)}</a>`);
				expect(html).toContain(`>${escaped(text.cta ?? rest.view)}</a>`);
			}
		});
	}
});
