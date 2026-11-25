import type { OutboxEntry } from "@/data/outbox";
import { parkedFrom, rebases } from "./parked-entry";

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
	it("names a parked delete by the amount the device booked, with no title", () => {
		const parked = parkedFrom({
			...entry({ id: "e1" }, "expense_changed"),
			kind: "delete",
			targetId: "e1",
			device: {
				bookedAt: 1,
				changed: [],
				changes: [
					{
						table: "expenses",
						id: "e1",
						before: { amount: "100.00", currency: "USD" } as never,
						after: null,
					},
				],
			},
		});
		expect(parked).toMatchObject({
			title: "",
			amount: { minor: 10_000, currency: "USD" },
			reason: "expense_changed",
			kind: "delete",
		});
	});

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
			kind: "create",
			gone: false,
			retryable: true,
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

describe("rebases", () => {
	const parked = (kind: OutboxEntry["kind"], reason: string) =>
		parkedFrom({ ...entry({ id: "e1" }, reason), kind });

	it("is Try again over the pulled row for an edit or delete that met a newer row or lost its chain", () => {
		expect(rebases(parked("update", "expense_changed"))).toBe(true);
		expect(rebases(parked("delete", "expense_changed"))).toBe(true);
		expect(rebases(parked("update", "chain_lost"))).toBe(true);
		// Sent again as it is, these answer the same: the same stamp, the same key.
		expect(rebases(parked("update", "no_stamp"))).toBe(true);
		expect(rebases(parked("delete", "idempotency_key_reused"))).toBe(true);
	});

	it("a create parked because its key holds another request is not retryable", () => {
		const create = (reason: string) => parkedFrom(entry({ id: "e1" }, reason));
		expect(create("idempotency_key_reused").retryable).toBe(false);
		expect(create("forbidden").retryable).toBe(true);
	});

	it("an edit with no device booking is not retryable, a create or delete is", () => {
		const bare = (kind: OutboxEntry["kind"]) =>
			parkedFrom({ ...entry({ id: "e1" }, "expense_changed"), kind });
		expect(bare("update").retryable).toBe(false);
		expect(bare("delete").retryable).toBe(true);
		expect(bare("create").retryable).toBe(true);
		const booked = parkedFrom({
			...entry({ id: "e1" }, "expense_changed"),
			kind: "update",
			device: { bookedAt: 1, changed: ["title"], changes: [] },
		});
		expect(booked.retryable).toBe(true);
	});

	it("is not for a create, or for a write the server refused outright", () => {
		expect(rebases(parked("create", "expense_changed"))).toBe(false);
		expect(rebases(parked("update", "forbidden"))).toBe(false);
		expect(rebases(parked("update", "not_found"))).toBe(false);
	});
});
