import { describe, expect, it } from "vitest";
import { assertE2eDatabase, e2eDatabaseProblem } from "./db-guard";

const ok =
	"postgresql://postgres:testpassword@127.0.0.1:5436/retrospend_test_e2e";

describe("e2eDatabaseProblem", () => {
	it("accepts the local test database", () => {
		expect(e2eDatabaseProblem(ok)).toBeNull();
		expect(
			e2eDatabaseProblem(
				"postgres://u:p@localhost:5436/retrospend_test_e2e_two",
			),
		).toBeNull();
		expect(
			e2eDatabaseProblem("postgresql://u:p@[::1]:5436/retrospend_test_e2e"),
		).toBeNull();
	});

	it("refuses other hosts, ports and names", () => {
		expect(
			e2eDatabaseProblem(
				"postgresql://u:p@db.example.com:5436/retrospend_test_e2e",
			),
		).toMatch(/host/);
		expect(
			e2eDatabaseProblem("postgresql://u:p@127.0.0.1:5434/retrospend_test_e2e"),
		).toMatch(/port/);
		expect(
			e2eDatabaseProblem("postgresql://u:p@127.0.0.1/retrospend_test_e2e"),
		).toMatch(/port/);
		expect(
			e2eDatabaseProblem("postgresql://u:p@127.0.0.1:5436/retrospend_dev"),
		).toMatch(/retrospend_test_e2e/);
		expect(
			e2eDatabaseProblem("mysql://u:p@127.0.0.1:5436/retrospend_test_e2e"),
		).toMatch(/Postgres/);
		expect(e2eDatabaseProblem("not a url")).toMatch(/not a URL/);
	});

	it("refuses a ?host= override", () => {
		expect(e2eDatabaseProblem(`${ok}?host=/var/run/postgresql`)).toMatch(
			/host=/,
		);
	});
});

describe("assertE2eDatabase", () => {
	it("throws on an unsafe URL unless staging opts in", () => {
		const prod = "postgresql://u:p@10.0.0.5:5432/retrospend";
		expect(() => assertE2eDatabase(prod, {})).toThrow(/Refusing/);
		expect(() =>
			assertE2eDatabase(prod, { E2E_ALLOW_STAGING_DB: "1" }),
		).not.toThrow();
		expect(() => assertE2eDatabase(ok, {})).not.toThrow();
	});
});
