import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Every web prompt that sends a typed password the server checks must send the
// sign-in secret instead (src/lib/protection/sign-in-secret.ts), or an account
// with Advanced protection keys could not use it, and a prompt that skipped the
// helper would send the typed password to a server that may be lying about the
// keys.
//
// What is a behavior test and what is not. The helper's behavior (a keyed
// account's typed password never leaves, in any server state) is tested in
// sign-in-secret.test.ts and rotate-password.test.ts against a recording
// fetch. Rendering the prompts is not practical here (the repo has no DOM
// environment or component test setup and no new dependency may be added),
// so this file checks the other half, that each prompt sends only what the
// helper returned, by reading the source with a small scanner (not one regex
// per call site): every object-literal entry named *password* in a prompt is
// found, in single or multiple lines, shorthand or not, and its value must be
// the helper's result. The scanner's own tests below show it flags the forms
// a regex missed (`password: password`, shorthand, multiline), and the
// inventory finds a password field by its autocomplete, not only by type.
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
 * the change-password sheet, which sends nothing typed for an account with
 * keys: rotatePassword derives the secrets in the browser (K2).
 */
const NOT_CHECKING = [
	"app/(site)/signup/_components/signup-form.tsx",
	"features/recovery/plain-reset-form.tsx",
	"features/settings/security/password-sheet.tsx",
	// The enable sheet's new password becomes keys in the browser (makeKeys) and
	// is dropped. Its Confirm it's you step only hands the typed text to the
	// sheet's `save` callback and sends nothing itself. What `save` sends is
	// built in one place, the shared enable callbacks, which the "enable
	// callbacks" test below inventories (it is not a .tsx prompt, so it cannot
	// join CHECKING_PROMPTS); the web adapter sends only what they hand it.
	"features/settings/protection/enable-steps.tsx",
	"features/settings/protection/finish-steps.tsx",
	// The recovery sheet's new password becomes wraps in the browser
	// (finishRecovery) and goes nowhere else; Make new key's password step only
	// hands the typed text to the sheet's `makeKey`, which derives the sign-in
	// secret in the shared callbacks. The "recovery and new key callbacks"
	// test below inventories what each sends.
	"features/recovery/recover-steps.tsx",
	"features/recovery/new-key-sheet.tsx",
];

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

type Entry = { key: string; value: string };

/** The source with comments gone and the inside of string literals emptied, so a bracket in text cannot confuse the scan. */
function bare(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/.*$/gm, "$1")
		.replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
		.replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
		.replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

/** The index of the bracket that closes the one at `open`, or -1. */
function closeOf(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if ("([{".includes(text[i] as string)) depth++;
		else if (")]}".includes(text[i] as string) && --depth === 0) return i;
	}
	return -1;
}

/**
 * Every object-literal entry whose key has "password" in it (any case),
 * shorthand or not, on one line or many, with its value as written. JSX
 * attributes (`value={password}`), destructuring patterns and parameter lists
 * are not object literals and are skipped.
 */
function passwordEntries(source: string): Entry[] {
	const text = bare(source);
	const out: Entry[] = [];
	for (const m of text.matchAll(/[{,]\s*(\w*[Pp]assword\w*)(?=\s*[:,}])/g)) {
		const at = (m.index ?? 0) + m[0].indexOf(m[1] as string);
		// The innermost bracket around the key must be a brace.
		let depth = 0;
		let open = -1;
		for (let i = at - 1; i >= 0; i--) {
			const c = text[i] as string;
			if (")]}".includes(c)) depth++;
			else if ("([{".includes(c) && depth-- === 0) {
				open = i;
				break;
			}
		}
		if (open < 0 || text[open] !== "{") continue;
		// `attr={x}` is a JSX expression.
		if (text[open - 1] === "=") continue;
		const close = closeOf(text, open);
		const after = text.slice(close + 1).match(/^\s*(:|=(?!>))/);
		const before = text.slice(0, open).match(/(\w+)\s*$/)?.[1];
		// A destructuring pattern or an import list.
		if (after || before === "import" || before === "export") continue;
		const rest = text.slice(at + (m[1] as string).length);
		const colon = rest.match(/^\s*:/);
		if (!colon) {
			out.push({ key: m[1] as string, value: m[1] as string });
			continue;
		}
		let end = colon[0].length;
		for (let d = 0; end < rest.length; end++) {
			const c = rest[end] as string;
			if ("([{".includes(c)) d++;
			else if (")]}".includes(c)) {
				if (d === 0) break;
				d--;
			} else if (c === "," && d === 0) break;
		}
		out.push({
			key: m[1] as string,
			value: rest.slice(colon[0].length, end).replace(/\s+/g, " ").trim(),
		});
	}
	return out;
}

/** What each checking prompt sends, key and value as written: the helper's result and nothing typed. */
const SENDS: Record<string, Entry[]> = {
	"app/(site)/login/_components/login-form.tsx": [
		{ key: "password", value: "secret" },
	],
	"features/profile/email-sheet.tsx": [
		{ key: "currentPassword", value: "await signInSecret(password)" },
	],
	"features/settings/danger/delete-account-sheet.tsx": [
		{ key: "password", value: "await signInSecret(password)" },
	],
	"features/settings/security/two-factor-on-sheet.tsx": [
		{ key: "password", value: "await signInSecret(password)" },
	],
	// Backup codes and turning off: two sends in one file.
	"features/settings/security/two-factor-sheets.tsx": [
		{ key: "password", value: "await signInSecret(password)" },
		{ key: "password", value: "await signInSecret(password)" },
	],
};

describe("enable callbacks", () => {
	const CORE = "../packages/crypto/src/client/enable-flow.ts";
	const ADAPTER = "lib/protection/enable.ts";

	it("put the typed password in one request, built after the keyed record was checked", () => {
		const core = read(CORE);
		// (Type literals with a password field also scan as entries; only the request is a send.)
		expect(
			passwordEntries(core).filter(
				(e) => e.key === "currentPassword" && e.value === "input.password",
			),
		).toEqual([{ key: "currentPassword", value: "input.password" }]);
		// Behavior is tested in packages/crypto/test/client-enable-flow.test.ts
		// ("a device that knows the account is keyed"); this keeps the one
		// request from moving above the check unnoticed.
		expect(core.indexOf("ports.record.has()")).toBeGreaterThan(-1);
		expect(core.indexOf("ports.record.has()")).toBeLessThan(
			core.lastIndexOf("currentPassword:"),
		);
	});

	it("send the web adapter's typed password nowhere but through the shared callbacks and the sign-in helper", () => {
		// The adapter hands the typed password to the shared callbacks and to the
		// sign-in helper (which refuses a keyed address); it builds no request of its own with one.
		const adapter = read(ADAPTER);
		// The one field is the sign-in secret the helper returned, as in the sign-in form.
		expect(passwordEntries(adapter)).toEqual([
			{ key: "password", value: "secret" },
		]);
		expect(adapter).toMatch(
			/secret = await signInSecretFor\(account\.email, password,/,
		);
	});
});

describe("recovery and new key callbacks", () => {
	const CLIENT = "../packages/crypto/src/client";

	it("have web adapters that build no request with a typed password", () => {
		expect(passwordEntries(read("lib/protection/recovery.ts"))).toEqual([]);
		expect(passwordEntries(read("lib/protection/new-key.ts"))).toEqual([]);
	});

	it("hand the typed password only to the step that derives from it, and put none in a request", () => {
		// Recovery: the new password goes to finishRecovery, which wraps the key
		// and sends nothing but the derived sign-in secret.
		// (Type literals with a password field also scan as entries, as `string`.)
		const sent = (path: string) =>
			passwordEntries(read(path)).filter((e) => e.value !== "string");
		expect(sent(`${CLIENT}/recovery-flow.ts`)).toEqual([
			{ key: "password", value: "input.password" },
		]);
		// Make new key: the current password goes to prepareNewRecoveryKey, which
		// derives the sign-in secret in the browser; the commit body has none.
		expect(sent(`${CLIENT}/new-key-flow.ts`)).toEqual([
			{ key: "password", value: "password" },
		]);
	});
});

describe("the scan for what a prompt sends", () => {
	it("finds the forms a single regex missed", () => {
		const find = (code: string) => passwordEntries(code);
		expect(find("send({ password: password });")).toEqual([
			{ key: "password", value: "password" },
		]);
		expect(find("send({ email, password });")).toEqual([
			{ key: "password", value: "password" },
		]);
		expect(
			find("send({\n\tpassword:\n\t\tawait other(password),\n});"),
		).toEqual([{ key: "password", value: "await other(password)" }]);
		expect(find("send({ a: 1, currentPassword: typed, b: f(1, 2) });")).toEqual(
			[{ key: "currentPassword", value: "typed" }],
		);
	});

	it("skips what is not an object literal", () => {
		expect(
			passwordEntries(
				'<Input value={password} />; const { password } = props; function f({ password }: P) {} import { x, password } from "y"; call(a, password, b);',
			),
		).toEqual([]);
	});
});

describe("web password prompts", () => {
	it("lists every password field in the app", () => {
		// By type or by autocomplete (a field that passes either through a helper
		// has the other literal in the file too).
		const field =
			/type="password"|autoComplete="(?:current|new)-password"|,\s*["'](?:current|new)-password["']/;
		const found = sources(ROOT)
			.filter((p) => field.test(read(relative(ROOT, p))))
			.map((p) => relative(ROOT, p))
			.sort();
		expect(found).toEqual([...CHECKING_PROMPTS, ...NOT_CHECKING].sort());
	});

	it("each checking prompt sends what the helper returned and nothing typed", () => {
		expect(Object.keys(SENDS).sort()).toEqual([...CHECKING_PROMPTS].sort());
		for (const path of CHECKING_PROMPTS)
			expect(passwordEntries(read(path)), path).toEqual(SENDS[path]);
		// The sign-in form's `secret` is only ever the helper's result.
		const login = read(CHECKING_PROMPTS[0] ?? "");
		expect(login).toMatch(/secret = await signInSecret\(address, password\)/);
		expect(login.match(/\bsecret =/g)).toHaveLength(1);
	});

	it("each checking prompt gets its helper from the hook, not from the sign-in module", () => {
		for (const path of CHECKING_PROMPTS)
			expect(read(path), path).toMatch(
				/const signInSecret = use(Session)?SignInSecret\(\)/,
			);
	});

	it("offers the way out of a stale keyed record on the form and clears it after a reset", () => {
		const login = read("app/(site)/login/_components/login-form.tsx");
		expect(login).toContain("isDowngradeRefusal(e)");
		expect(login).toMatch(/forgetKeyed\(staleFor\)[\s\S]*await signIn\(\)/);
		expect(login).toContain("ConfirmationDialog");
		expect(read("features/recovery/plain-reset-form.tsx")).toMatch(
			/onSuccess: async \(\{ email \}\) => \{\s*await forgetKeyed\(email\)/,
		);
	});

	it("asks whether the account is keyed before the password change sends anything, and rotates the keyed ones", () => {
		const sheet = read("features/settings/security/password-sheet.tsx");
		expect(sheet).toMatch(
			/if \(await isKeyed\(\)\) \{\s*await rotate\(current, next\);[\s\S]*?return;\s*\}[\s\S]*mutateAsync/,
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
