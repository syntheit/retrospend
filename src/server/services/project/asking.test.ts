import { describe, expect, it } from "vitest";
import { askingOf } from "./asking";

const row = (paid: string, created: string) => ({
	paidByType: "user" as const,
	paidById: paid,
	createdByType: "user" as const,
	createdById: created,
});
const me = (r: { participantId: string }) => r.participantId === "sofia";

describe("askingOf", () => {
	it("is the payer when someone else paid", () => {
		expect(askingOf(row("lucia", "martin"), me)).toEqual({
			participantType: "user",
			participantId: "lucia",
		});
	});

	it("is the creator when you paid and someone else added it", () => {
		expect(askingOf(row("sofia", "paz"), me)).toEqual({
			participantType: "user",
			participantId: "paz",
		});
	});

	it("is no one when you paid and added it", () => {
		expect(askingOf(row("sofia", "sofia"), me)).toBeNull();
	});
});
