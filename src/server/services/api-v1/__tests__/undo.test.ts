import { describe, expect, it, vi } from "vitest";
import { mintUndo, readUndo, UNDO_TTL_MS } from "../undo";

vi.mock("~/env", () => ({
	env: { BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789" },
}));

const NOW = Date.UTC(2026, 9, 24, 12);

describe("undo tokens", () => {
	it("round-trips the inverse call for its user and group", () => {
		const token = mintUndo(
			"u1",
			"expense",
			"expense.delete",
			{ id: "e1" },
			NOW,
		);
		expect(readUndo("u1", "expense", token, NOW + 1000)).toEqual({
			op: "expense.delete",
			input: { id: "e1" },
		});
	});

	it("expires after 24 hours", () => {
		const token = mintUndo("u1", "income", "income.delete", {}, NOW);
		expect(() =>
			readUndo("u1", "income", token, NOW + UNDO_TTL_MS - 1),
		).not.toThrow();
		expect(() =>
			readUndo("u1", "income", token, NOW + UNDO_TTL_MS + 1),
		).toThrow("not valid");
	});

	it("is for one user and one group", () => {
		const token = mintUndo("u1", "transfer", "transfer.delete", {}, NOW);
		expect(() => readUndo("u2", "transfer", token, NOW)).toThrow();
		expect(() => readUndo("u1", "income", token, NOW)).toThrow();
	});

	it("refuses a changed or made-up token", () => {
		const token = mintUndo(
			"u1",
			"expense",
			"expense.delete",
			{ id: "e1" },
			NOW,
		);
		const [data, sig] = token.split(".") as [string, string];
		const forged = Buffer.from(
			JSON.stringify({
				v: 1,
				userId: "u1",
				family: "expense",
				op: "expense.delete",
				input: { id: "someone-elses" },
				exp: NOW + 1000,
			}),
		).toString("base64url");
		expect(() => readUndo("u1", "expense", `${forged}.${sig}`, NOW)).toThrow();
		expect(() =>
			readUndo("u1", "expense", `${data}.${"0".repeat(64)}`, NOW),
		).toThrow();
		for (const bad of ["", "x", "a.b", `${data}.${sig}.extra`])
			expect(() => readUndo("u1", "expense", bad, NOW)).toThrow();
	});
});
