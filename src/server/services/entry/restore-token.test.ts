import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import {
	RESTORE_TTL_MS,
	readRestore,
	readRowRestore,
	signRestore,
} from "./restore-token";

const NOW = Date.UTC(2026, 10, 12, 12);
const refused = (run: () => unknown) => {
	let thrown: unknown;
	try {
		run();
	} catch (error) {
		thrown = error;
	}
	expect(thrown).toBeInstanceOf(TRPCError);
	expect(thrown).toMatchObject({
		code: "BAD_REQUEST",
		message: "This undo is not valid anymore",
	});
};

describe("restore tokens", () => {
	const token = signRestore("expense.delete", "u1", { id: "e1" }, NOW);

	it("reads back the payload for its kind, user and time", () => {
		expect(readRestore(token, "expense.delete", "u1", NOW)).toEqual({
			id: "e1",
		});
		// The last millisecond of its 24 hours still counts.
		expect(
			readRestore(token, "expense.delete", "u1", NOW + RESTORE_TTL_MS),
		).toEqual({ id: "e1" });
	});

	it("refuses another kind, another user, an expired or a forged token", () => {
		refused(() => readRestore(token, "expense.update", "u1", NOW));
		refused(() => readRestore(token, "expense.delete", "u2", NOW));
		refused(() =>
			readRestore(token, "expense.delete", "u1", NOW + RESTORE_TTL_MS + 1),
		);
		refused(() =>
			readRestore({ ...token, sig: "0".repeat(64) }, "expense.delete", "u1"),
		);
		// A signed payload of another shape (a v1 undo, a bare value) is not a token.
		refused(() => readRestore(signRestore("x", "u1", null), "y", "u1"));
	});

	it("a row restore refuses a changed account or keep flag", () => {
		const row = {
			id: "i1",
			amount: "1000",
			currency: "ARS",
			date: "2026-11-12",
			home: "ARS",
			bound: { into: "a1", keep: false },
		};
		const signed = signRestore("income.delete", "u1", {
			...row,
			figures: { units: "1000" },
		});
		expect(readRowRestore(signed, "income.delete", "u1", row)).toEqual({
			units: "1000",
		});
		expect(
			readRowRestore(signed, "income.delete", "u1", {
				...row,
				amount: "1000.00",
			}),
		).toEqual({ units: "1000" });
		for (const bound of [
			{ into: "a2", keep: false },
			{ into: "a1", keep: true },
			{ into: null, keep: false },
		])
			refused(() =>
				readRowRestore(signed, "income.delete", "u1", { ...row, bound }),
			);
	});
});
