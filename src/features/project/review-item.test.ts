import { describe, expect, it } from "vitest";
import { verifyOfRow } from "./review-item";
import type { ExpenseRow } from "./types";

const row = (over: Partial<ExpenseRow> = {}): ExpenseRow => ({
	id: "t1",
	title: "Hospedagem, segunda casa",
	date: "2026-10-12",
	category: null,
	amount: { minor: 62_000, currency: "BRL" },
	share: { minor: 20_667, currency: "BRL" },
	people: [],
	payerId: "user:lucia",
	payerName: "Lucía",
	payerIsMe: false,
	waiting: "review",
	asking: { id: "user:lucia", name: "Lucía", imageUrl: "/lucia.png" },
	mine: false,
	locked: false,
	...over,
});

describe("verifyOfRow", () => {
	it("builds the review sheet's item from the row, asking person as the server sent it", () => {
		expect(verifyOfRow(row())).toEqual({
			kind: "verify",
			id: "t1",
			person: {
				key: "user:lucia",
				type: "user",
				id: "lucia",
				name: "Lucía",
				username: null,
				imageUrl: "/lucia.png",
				onRetrospend: true,
			},
			title: "Hospedagem, segunda casa",
			amount: { minor: 20_667, currency: "BRL" },
			date: "2026-10-12",
		});
	});

	it("is a person added by name, not an account, for a shadow asker", () => {
		const item = verifyOfRow(
			row({ asking: { id: "shadow:s1", name: "Sam", imageUrl: null } }),
		);
		expect(item).toMatchObject({
			person: { type: "shadow", id: "s1", onRetrospend: false },
		});
	});

	it("is null when the row is not waiting on you or no one is asking", () => {
		expect(verifyOfRow(row({ waiting: null }))).toBeNull();
		expect(verifyOfRow(row({ waiting: "rejected" }))).toBeNull();
		expect(verifyOfRow(row({ asking: null }))).toBeNull();
		expect(verifyOfRow(row({ share: null }))).toBeNull();
	});
});
