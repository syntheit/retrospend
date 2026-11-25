import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { contract } from "@retrospend/api-contract";
import { describe, expect, it } from "vitest";

// The paths test for the web's side of the key routes (AGENTS.md 6.8): which
// files of src call the routes that release wraps, take a recovery proof or
// replace a recovery key. The list is a search result, not a promise; a new
// caller fails here until it is added with its reason.
const SRC = join(__dirname, "..", "..");

function files(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory())
			return entry.name === "server" || entry.name === "node_modules"
				? []
				: files(path);
		return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)
			? [path]
			: [];
	});
}

const callers = (needle: string) =>
	files(SRC)
		.filter((path) => readFileSync(path, "utf8").includes(needle))
		.map((path) => relative(SRC, path))
		.sort();

describe("the web's callers of the key routes", () => {
	it("keys/open is read by the enable read-back and by Make new key, nothing else", () => {
		expect(callers("/api/v1/me/protection/keys/open")).toEqual([
			"lib/protection/enable.ts",
			"lib/protection/new-key.ts",
		]);
	});

	it("the recovery key route is called by Make new key only", () => {
		expect(callers("/api/v1/me/protection/recovery-key")).toEqual([
			"lib/protection/new-key.ts",
		]);
	});

	it("the recovery routes, which take a reset token and a proof, are called by the recovery adapter only", () => {
		expect(callers("/api/v1/auth/recovery")).toEqual([
			"lib/protection/recovery.ts",
		]);
	});
});

// The phone's side, from the same source of truth: the contract's route table
// names each operation, and the phone calls it through the typed client by that
// name (`api.openKeys(...)`, or `"openKeys"` in a Pick of the client's type).
// A new caller in apps/mobile fails here until it is added with its reason.
const MOBILE = join(SRC, "..", "apps", "mobile", "src");

function mobileFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory())
			return entry.name === "node_modules" ? [] : mobileFiles(path);
		return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)
			? [path]
			: [];
	});
}

/** The client operation name of the contract route at `path`, found in the route table. */
function operationAt(path: string): string {
	const found: string[] = [];
	for (const group of Object.values(contract) as Record<string, unknown>[]) {
		for (const [name, proc] of Object.entries(group)) {
			const route = (
				proc as { "~orpc"?: { route?: { path?: string } } } | undefined
			)?.["~orpc"]?.route;
			if (route?.path === path) found.push(name);
		}
	}
	if (found.length !== 1) throw new Error(`no single route at ${path}`);
	return found[0] as string;
}

const mobileCallers = (path: string) => {
	const name = operationAt(path);
	const call = new RegExp(`\\.${name}\\(|"${name}"`);
	return mobileFiles(MOBILE)
		.filter((file) => call.test(readFileSync(file, "utf8")))
		.map((file) => relative(MOBILE, file))
		.sort();
};

describe("the phone's callers of the key routes", () => {
	it("keys/open is read by the enable read-back and by Make new key, nothing else", () => {
		expect(mobileCallers("/me/protection/keys/open")).toEqual([
			"auth/enable.ts",
			"auth/new-key.ts",
		]);
	});

	it("the recovery key route is called by Make new key only", () => {
		expect(mobileCallers("/me/protection/recovery-key")).toEqual([
			"auth/new-key.ts",
		]);
	});

	it("the recovery routes, which take a reset token and a proof, are called by the recovery adapter only", () => {
		for (const path of [
			"/auth/recovery",
			"/auth/recovery/begin",
			"/auth/recovery/check",
		])
			expect(mobileCallers(path), path).toEqual(["auth/recovery.ts"]);
	});

	it("the reset code routes are called by the recovery adapter only", () => {
		for (const path of ["/auth/password-reset", "/auth/password-reset/code"])
			expect(mobileCallers(path), path).toEqual(["auth/recovery.ts"]);
	});
});

// A locked sheet (recovery, Make new key, enable) waits on these adapters, so
// no network call in them may be left without a time limit: a hang would hold
// the person until the app is killed. The calls are found from the contract's
// route table (every operation name) plus the session's sign-in calls; each
// must sit inside `callWithTimeout(...)` or `withTimeout(...)`.
const LOCKED_ADAPTERS = [
	"auth/recovery.ts",
	"auth/new-key.ts",
	"auth/enable.ts",
];

function allOperationNames(): string[] {
	const names = new Set<string>();
	for (const group of Object.values(contract) as Record<string, unknown>[])
		for (const [name, proc] of Object.entries(group))
			if ((proc as { "~orpc"?: unknown } | undefined)?.["~orpc"])
				names.add(name);
	return [...names];
}

/** The [start, end) spans of the argument lists of `name(` calls in `text`. */
function argumentSpans(text: string, name: string): [number, number][] {
	const spans: [number, number][] = [];
	const open = new RegExp(`\\b${name}\\(`, "g");
	for (let m = open.exec(text); m; m = open.exec(text)) {
		let depth = 1;
		let i = m.index + m[0].length;
		const start = i;
		while (i < text.length && depth > 0) {
			if (text[i] === "(") depth++;
			else if (text[i] === ")") depth--;
			i++;
		}
		spans.push([start, i]);
	}
	return spans;
}

/** Network calls in `text` that are not inside a time-limited wrapper. */
function unboundedCalls(text: string): string[] {
	const wrapped = [
		...argumentSpans(text, "callWithTimeout"),
		...argumentSpans(text, "withTimeout"),
		// enable.ts's own wrapper for a sign-in step; checked to be bounded below.
		...argumentSpans(text, "timedStep"),
	];
	const found: string[] = [];
	const clients = new RegExp(
		`\\b(?:input\\.)?api\\.(?:${allOperationNames().join("|")})\\(|\\.session\\(\\)\\.(?:signIn|verifyCode)\\(`,
		"g",
	);
	for (let m = clients.exec(text); m; m = clients.exec(text))
		if (!wrapped.some(([from, to]) => m.index >= from && m.index < to))
			found.push(m[0]);
	return found;
}

describe("the phone's adapters under a locked sheet", () => {
	it("every client and sign-in call is inside a time limit", () => {
		for (const file of LOCKED_ADAPTERS)
			expect(
				unboundedCalls(readFileSync(join(MOBILE, file), "utf8")),
				file,
			).toEqual([]);
	});

	it("the sign-in step wrapper is itself inside a time limit", () => {
		const text = readFileSync(join(MOBILE, "auth/enable.ts"), "utf8");
		const body = text.slice(text.indexOf("async function timedStep("));
		expect(body.slice(0, body.indexOf("\n}\n"))).toContain("withTimeout(");
	});

	it("finds a call that is not wrapped, and one that is", () => {
		expect(unboundedCalls("await input.api.openKeys(body);")).toEqual([
			"input.api.openKeys(",
		]);
		expect(unboundedCalls("await input.session().signIn(a, b);")).toEqual([
			".session().signIn(",
		]);
		expect(
			unboundedCalls("withTimeout((o) => input.api.keys(undefined, o))"),
		).toEqual([]);
		expect(
			unboundedCalls(
				"callWithTimeout((o) =>\n api.recover({ token, ...body }, o))",
			),
		).toEqual([]);
	});
});
