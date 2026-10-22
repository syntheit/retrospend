import { describe, expect, it } from "vitest";
import { parseTestDatabaseUrl } from "./pg-global-setup";

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
