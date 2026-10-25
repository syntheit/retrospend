import type { OutboxEntry } from "@/data/outbox";
import { parkedFrom } from "./parked-entry";

const entry = (payload: unknown, lastError: string | null): OutboxEntry => ({
	clientId: "c1",
	entity: "expenses",
	kind: "create",
	targetId: "c1",
	baseVersion: null,
	payload,
	createdAt: "2026-10-25T10:00:00.000Z",
	attempts: 1,
	networkFailures: 0,
	serverErrors: 0,
	state: "conflict",
	lastError,
});

describe("parkedFrom", () => {
	it("names a parked expense with its amount in minor units", () => {
		expect(
			parkedFrom(
				entry(
					{ title: "Taxi", amount: "12500.50", currency: "ARS" },
					"forbidden",
				),
			),
		).toEqual({
			clientId: "c1",
			title: "Taxi",
			amount: { minor: 1_250_050, currency: "ARS" },
			reason: "forbidden",
		});
	});

	it("reads a split expense's description as its title", () => {
		const parked = parkedFrom(
			entry({ description: "Dinner", amount: "30", currency: "USD" }, null),
		);
		expect(parked).toMatchObject({
			title: "Dinner",
			amount: { minor: 3000, currency: "USD" },
			reason: "refused",
		});
	});

	it("keeps a row whose amount does not read", () => {
		expect(
			parkedFrom(entry({ title: "Odd", amount: "x", currency: "ARS" }, null))
				.amount,
		).toBeNull();
	});
});
