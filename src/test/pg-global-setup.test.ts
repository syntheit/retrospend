import { describe, expect, it } from "vitest";
import { runDatabaseNames } from "./pg-global-setup";
import { parseTestDatabaseUrl } from "./pg-test-url";

const url = (hostPort: string, name: string) =>
	`postgresql://postgres:testpassword@${hostPort}/${name}`;

describe("parseTestDatabaseUrl", () => {
	it("accepts the shared test Postgres with a worktree name", () => {
		const { baseUrl, baseName } = parseTestDatabaseUrl(
			url("localhost:5436", "retrospend_test_s0b"),
		);
		expect(baseName).toBe("retrospend_test_s0b");
		expect(baseUrl.port).toBe("5436");
	});

	it("accepts the CI service on the default port and IP hosts", () => {
		expect(() =>
			parseTestDatabaseUrl(url("localhost", "retrospend_test")),
		).not.toThrow();
		expect(() =>
			parseTestDatabaseUrl(url("127.0.0.1:5432", "retrospend_test")),
		).not.toThrow();
		expect(() =>
			parseTestDatabaseUrl(url("[::1]:5436", "retrospend_test_a")),
		).not.toThrow();
	});

	it("refuses a missing URL", () => {
		expect(() => parseTestDatabaseUrl(undefined)).toThrow(/not set/);
	});

	it("refuses the dev and staging databases even with a test name", () => {
		expect(() =>
			parseTestDatabaseUrl(url("localhost:5434", "retrospend_test")),
		).toThrow(/port 5434/);
		expect(() =>
			parseTestDatabaseUrl(url("127.0.0.1:5435", "retrospend_test")),
		).toThrow(/port 5435/);
		expect(() =>
			parseTestDatabaseUrl(url("localhost:1997", "retrospend_test")),
		).toThrow(/port 1997/);
	});

	it("refuses a host that is not local", () => {
		expect(() =>
			parseTestDatabaseUrl(url("postgres:5432", "retrospend_test")),
		).toThrow(/localhost/);
		expect(() =>
			parseTestDatabaseUrl(url("100.109.63.87:5436", "retrospend_test")),
		).toThrow(/localhost/);
	});

	it("refuses a database name that is not a test one", () => {
		for (const name of [
			"retrospend",
			"retrospend_dev",
			"retrospend_testing",
			"",
			"retrospend_test_Upper",
		]) {
			expect(() => parseTestDatabaseUrl(url("localhost:5436", name))).toThrow(
				/retrospend_test/,
			);
		}
	});
});

describe("runDatabaseNames", () => {
	const longest = `retrospend_test_${"a".repeat(38)}`;

	it("names a template and one database per worker", () => {
		const names = runDatabaseNames("retrospend_test_x", "ab12", 3);
		expect(names.template).toBe("retrospend_test_x_ab12_tpl");
		expect(names.workers).toEqual([
			"retrospend_test_x_ab12_w1",
			"retrospend_test_x_ab12_w2",
			"retrospend_test_x_ab12_w3",
		]);
	});

	it("fits the 63 byte limit for the longest base name and 16 workers", () => {
		expect(longest.length).toBe(54);
		const names = runDatabaseNames(longest, "ab12", 16);
		for (const name of [names.template, ...names.workers]) {
			expect(Buffer.byteLength(name)).toBeLessThanOrEqual(63);
		}
	});

	it("refuses a name that would be truncated", () => {
		expect(() => runDatabaseNames(longest, "ab12cd", 16)).toThrow(/63 bytes/);
	});
});
