import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Every web prompt that sends a typed password the server checks must send the
// sign-in secret instead (src/lib/protection/sign-in-secret.ts), or an account
// with Advanced protection keys could not use it, and a prompt that skipped the
// helper would send the typed password to a server that may be lying about the
// keys. These are source checks: the sheets need a browser to render, and a
// new prompt that forgets the helper is the failure to catch.
const ROOT = join(import.meta.dirname, "../..");

function sources(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory())
			return name === "__tests__" || name === "docs" ? [] : sources(path);
		return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
	});
}

/** Prompts for a password the server checks, as paths under src. */
const CHECKING_PROMPTS = [
	"app/(site)/login/_components/login-form.tsx",
	"features/profile/email-sheet.tsx",
	"features/settings/danger/delete-account-sheet.tsx",
	"features/settings/security/two-factor-on-sheet.tsx",
	"features/settings/security/two-factor-sheets.tsx",
];

/**
 * Password fields that are not that: a new password (sign-up, reset), and
 * the change-password sheet, which the server refuses for an account with
 * keys (protected_password) until the key set can change with it.
 */
const NOT_CHECKING = [
	"app/(site)/signup/_components/signup-form.tsx",
	"app/(site)/auth/reset-password/page.tsx",
	"features/settings/security/password-sheet.tsx",
];

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("web password prompts", () => {
	it("lists every password field in the app", () => {
		const found = sources(ROOT)
			.filter((p) => read(relative(ROOT, p)).includes('type="password"'))
			.map((p) => relative(ROOT, p))
			.sort();
		expect(found).toEqual([...CHECKING_PROMPTS, ...NOT_CHECKING].sort());
	});

	it("each checking prompt gets the secret from the helper", () => {
		for (const path of CHECKING_PROMPTS)
			expect(read(path), path).toMatch(
				/use(Session)?SignInSecret\(\)[\s\S]*await signInSecret\(/,
			);
	});

	it("never hands the typed password straight to the server", () => {
		const login = read(CHECKING_PROMPTS[0] ?? "");
		expect(login).toMatch(
			/signIn\.email\(\{\s*email: address,\s*password: secret,/,
		);
		const direct = /(enable|disable|generateBackupCodes)\(\{\s*password[,\s}]/;
		for (const path of CHECKING_PROMPTS)
			expect(read(path), path).not.toMatch(direct);
		expect(read("features/profile/email-sheet.tsx")).not.toMatch(
			/currentPassword: password/,
		);
		expect(
			read("features/settings/danger/delete-account-sheet.tsx"),
		).not.toMatch(/mutateAsync\(\{ password \}\)/);
	});

	it("offers the way out of a stale keyed record on the form and clears it after a reset", () => {
		const login = read("app/(site)/login/_components/login-form.tsx");
		expect(login).toContain("isDowngradeRefusal(e)");
		expect(login).toMatch(/forgetKeyed\(staleFor\)[\s\S]*await signIn\(\)/);
		expect(login).toContain("ConfirmationDialog");
		expect(read("app/(site)/auth/reset-password/page.tsx")).toMatch(
			/onSuccess: async \(\{ email \}\) => \{\s*await forgetKeyed\(email\)/,
		);
	});

	it("asks whether the account is keyed before the password change sends anything", () => {
		const sheet = read("features/settings/security/password-sheet.tsx");
		expect(sheet).toMatch(
			/if \(await isKeyed\(\)\) throw new Error\(t\("locked"\)\);[\s\S]*mutateAsync/,
		);
	});

	it("shows the reset action only for the address that got the answer", () => {
		const login = read("app/(site)/login/_components/login-form.tsx");
		expect(login).toContain("staleFor === email.trim().toLowerCase()");
		expect(login).toContain("forgetKeyed(staleFor)");
	});

	it("forgets the keyed record once the account is deleted", () => {
		expect(read("features/settings/danger/delete-account-sheet.tsx")).toMatch(
			/mutateAsync\([\s\S]*?\);[\s\S]*?await forgetKeyed\(email\)/,
		);
	});

	it("words the prompts inside the app without mentioning sign-in", () => {
		const catalog = JSON.parse(
			read("../packages/i18n/messages/en/settingsV2.json"),
		) as { passwordCheck: Record<string, string> };
		for (const text of Object.values(catalog.passwordCheck))
			expect(text.toLowerCase()).not.toContain("sign");
	});

	it("shows the locked reason when the server refuses a password change", () => {
		expect(read("features/settings/security/password-sheet.tsx")).toContain(
			'"protected_password"',
		);
	});
});
