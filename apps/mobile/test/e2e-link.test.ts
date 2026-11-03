/**
 * @jest-environment node
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { E2E_SERVER_HOSTS, parseE2eLink } from "../src/dev/e2eSession";
import { systemPath } from "../src/surfaces/links";

const link = (query: string) => `retrospend://__e2e/session?${query}`;
const OK = "server=http%3A%2F%2F10.0.2.2%3A3200&email=a%40b.c&password=p%26w";

// The test-only sign-in link signs the app in to whatever server it names, so
// the allowlist is the whole defense: a link from anywhere on the phone must
// never connect a build to a server that is not the test one.
describe("parseE2eLink", () => {
	it("reads a session", () => {
		expect(parseE2eLink(link(OK))).toEqual({
			server: "http://10.0.2.2:3200",
			email: "a@b.c",
			password: "p&w",
			route: null,
		});
	});

	it("keeps an in-app route", () => {
		const session = parseE2eLink(link(`${OK}&route=%2F(tabs)%2Factivity`));
		expect(session?.route).toBe("/(tabs)/activity");
	});

	it.each([
		["localhost", "http://localhost:3201", "http://localhost:3201"],
		["the simulator loopback", "http://127.0.0.1:3203/", "http://127.0.0.1:3203"],
		["the emulator alias", "HTTP://10.0.2.2", "http://10.0.2.2"],
	])("accepts %s", (_name, server, expected) => {
		const query = `server=${encodeURIComponent(server)}&email=e&password=p`;
		expect(parseE2eLink(link(query))?.server).toBe(expected);
	});

	it("allows exactly the documented hosts", () => {
		expect(E2E_SERVER_HOSTS).toEqual(["localhost", "127.0.0.1", "10.0.2.2"]);
	});

	it.each([
		"https://retrospend.app",
		"https://dev.retrospend.app",
		"http://192.168.1.10:3000",
		"http://localhost.evil.example",
		"http://localhost@evil.example",
		"http://evil.example/localhost",
		"http://127.0.0.1:3000@evil.example",
		"http://10.0.2.20",
		"http://localhost:3000/api",
		"http://localhost:3000?x=1",
		"ftp://localhost",
		"localhost",
		"",
	])("refuses the server %j", (server) => {
		const query = `server=${encodeURIComponent(server)}&email=e&password=p`;
		expect(parseE2eLink(link(query))).toBeNull();
	});

	it.each([
		"server=http%3A%2F%2Flocalhost&email=e",
		"server=http%3A%2F%2Flocalhost&password=p",
		"email=e&password=p",
		"server=http%3A%2F%2Flocalhost&email=&password=p",
	])("refuses a link missing a field: %s", (query) => {
		expect(parseE2eLink(link(query))).toBeNull();
	});

	it.each([
		"https://evil.example",
		"//evil.example",
		"/../settings",
		"settings",
		"/a b",
	])("refuses the route %j", (route) => {
		expect(
			parseE2eLink(link(`${OK}&route=${encodeURIComponent(route)}`)),
		).toBeNull();
	});

	it("takes the first value of a repeated key", () => {
		const first = "server=http%3A%2F%2Flocalhost&email=e&password=p";
		const later = "&server=https%3A%2F%2Fevil.example";
		expect(parseE2eLink(link(first + later))?.server).toBe("http://localhost");
	});

	it("ignores other links and bad encoding", () => {
		expect(parseE2eLink("retrospend://add?amount=1")).toBeNull();
		expect(parseE2eLink("retrospend://__e2e/other?server=x")).toBeNull();
		expect(parseE2eLink("https://retrospend.app/__e2e/session?x=1")).toBeNull();
		expect(parseE2eLink(link("server=%E0%A4%A&email=e&password=p"))).toBeNull();
	});

	it("lands on the app start, not a screen, when the router sees the link", () => {
		expect(systemPath(link(OK))).toBe("/");
	});
});

// A release bundle is free of the link only if nothing reaches it except the
// require behind EXPO_PUBLIC_E2E (app/_layout.tsx), which Metro folds out.
describe("the e2e link stays behind its build flag", () => {
	const root = join(__dirname, "..");
	const files: string[] = [];
	function walk(dir: string) {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
				files.push(path);
			}
		}
	}
	walk(join(root, "src"));
	walk(join(root, "app"));

	it("is imported by no file outside src/dev but the gated require", () => {
		const offenders = files
			.filter((file) => !file.includes(join("src", "dev")))
			.filter((file) => /dev\/E2eLink|\/e2eSession/.test(readFileSync(file, "utf8")))
			.map((file) => relative(root, file));
		// The one allowed reference is the gated require in the root layout.
		expect(offenders).toEqual(["app/_layout.tsx"]);
	});

	it("is required only when the e2e flag is exactly 1", () => {
		const layout = readFileSync(join(root, "app", "_layout.tsx"), "utf8");
		expect(layout).toMatch(
			/process\.env\.EXPO_PUBLIC_E2E === "1"\s*\?\s*require\("@\/dev\/E2eLink"\)/,
		);
		expect(layout).not.toMatch(/^import .*E2eLink/m);
	});

	it("never logs", () => {
		for (const name of ["E2eLink.tsx", "e2eSession.ts"]) {
			const source = readFileSync(join(root, "src", "dev", name), "utf8");
			expect(source).not.toMatch(/console\.|logger|log\(/);
		}
	});
});
