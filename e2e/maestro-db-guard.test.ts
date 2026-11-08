import { describe, expect, it } from "vitest";
import {
	assertMaestroDatabase,
	maestroDatabaseProblem,
} from "./maestro-db-guard";

describe("maestroDatabaseProblem", () => {
	it("accepts an rs_e2e_ database on loopback, on any port", () => {
		for (const url of [
			"postgresql://postgres:x@127.0.0.1:5440/rs_e2e_template",
			"postgres://u:p@localhost:5436/rs_e2e_0",
			"postgresql://u:p@[::1]:5441/rs_e2e_1",
		]) {
			expect(maestroDatabaseProblem(url)).toBeNull();
		}
	});

	it("refuses other names, including the web e2e and dev databases", () => {
		for (const name of [
			"retrospend_test_e2e",
			"retrospend_dev",
			"retrospend",
			"postgres",
			"xrs_e2e_0",
			"",
		]) {
			expect(
				maestroDatabaseProblem(`postgresql://u:p@127.0.0.1:5440/${name}`),
			).toMatch(/not named rs_e2e_/);
		}
	});

	it("refuses hosts that are not loopback", () => {
		expect(
			maestroDatabaseProblem("postgresql://u:p@10.0.0.5:5440/rs_e2e_0"),
		).toMatch(/host/);
		expect(
			maestroDatabaseProblem("postgresql://u:p@db.example.com/rs_e2e_0"),
		).toMatch(/host/);
		expect(
			maestroDatabaseProblem(
				"postgresql://u:p@127.0.0.1.evil.example/rs_e2e_0",
			),
		).toMatch(/host/);
	});

	it("refuses a ?host= override, other protocols and junk", () => {
		expect(
			maestroDatabaseProblem(
				"postgresql://u:p@127.0.0.1:5440/rs_e2e_0?host=db.example.com",
			),
		).toMatch(/host=/);
		expect(maestroDatabaseProblem("mysql://u:p@127.0.0.1/rs_e2e_0")).toMatch(
			/Postgres/,
		);
		expect(maestroDatabaseProblem("nope")).toMatch(/not a URL/);
	});
});

describe("assertMaestroDatabase", () => {
	it("throws on an unsafe URL and passes a safe one", () => {
		expect(() =>
			assertMaestroDatabase(
				"postgresql://u:p@127.0.0.1:5436/retrospend_test_e2e",
			),
		).toThrow(/Refusing/);
		expect(() =>
			assertMaestroDatabase("postgresql://u:p@127.0.0.1:5440/rs_e2e_0"),
		).not.toThrow();
	});
});
