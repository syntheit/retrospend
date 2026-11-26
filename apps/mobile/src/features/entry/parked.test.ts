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

describe("a parked recurring confirm or skip", () => {
	const recurring = (
		kind: "confirm" | "skip",
		reason: string,
		payload: unknown = { dueAt: "2026-12-01T03:00:00.000Z", title: "Netflix" },
		device?: OutboxEntry["device"],
	): OutboxEntry => ({
		...entry(payload, reason),
		entity: "recurring",
		kind,
		targetId: "t1",
		baseVersion: "2026-11-18T10:00:00.000Z",
		...(device ? { device } : {}),
	});

	it("is named by the template's name and the amount typed with it", () => {
		expect(
			parkedFrom(
				recurring("confirm", "recurring_changed", {
					dueAt: "2026-12-01T03:00:00.000Z",
					title: "Netflix",
					currency: "USD",
					amount: "18.50",
				}),
			),
		).toMatchObject({
			title: "Netflix",
			amount: { minor: 1850, currency: "USD" },
			kind: "confirm",
			retryable: true,
		});
	});

	it("shows a fixed amount from the expense the device booked, and none for a skip", () => {
		const device = {
			bookedAt: 1,
			changed: [],
			changes: [
				{
					table: "expenses",
					id: "c1",
					before: null,
					after: { amount: "15.99", currency: "USD" } as never,
				},
			],
		} as OutboxEntry["device"];
		expect(
			parkedFrom(recurring("confirm", "not_found", undefined, device)).amount,
		).toEqual({ minor: 1599, currency: "USD" });
		expect(
			parkedFrom(recurring("skip", "not_found", undefined, device)).amount,
		).toBeNull();
		expect(parkedFrom(recurring("confirm", "not_found")).amount).toBeNull();
	});

	it("Try again re-bases over the pulled template when it was changed, not found, lost its chain or key", () => {
		for (const reason of [
			"recurring_changed",
			"not_found",
			"chain_lost",
			"no_stamp",
			"idempotency_key_reused",
		]) {
			expect(rebases(parkedFrom(recurring("confirm", reason)))).toBe(true);
			expect(rebases(parkedFrom(recurring("skip", reason)))).toBe(true);
		}
	});

	it("resends as it is for an id held by another row, a refusal or a server error, and never re-bases an already posted period", () => {
		for (const reason of [
			"id_taken",
			"recurring_already_posted",
			"bad_request",
			"internal_error",
		])
			expect(rebases(parkedFrom(recurring("confirm", reason)))).toBe(false);
	});
});

describe("a parked recurring template create or edit", () => {
	const template = (
		kind: "create" | "update",
		reason: string,
		payload: unknown,
	): OutboxEntry => ({
		...entry(payload, reason),
		entity: "recurring",
		kind,
		targetId: "t1",
		baseVersion: kind === "create" ? null : "2026-11-18T10:00:00.000Z",
	});
	const made = { name: "Gym", amount: "30", currency: "USD" };

	it("a create is named by its name and amount, and an edit by the name kept for this row", () => {
		expect(parkedFrom(template("create", "bad_request", made))).toMatchObject({
			title: "Gym",
			amount: { minor: 3000, currency: "USD" },
			kind: "create",
		});
		expect(
			parkedFrom(template("update", "recurring_changed", { title: "Netflix" })),
		).toMatchObject({ title: "Netflix", amount: null, kind: "update" });
	});

	it("a create that met a taken id is Discard only, any other create can be sent again", () => {
		expect(parkedFrom(template("create", "id_taken", made)).retryable).toBe(
			false,
		);
		expect(
			parkedFrom(template("create", "internal_error", made)).retryable,
		).toBe(true);
	});

	it("an edit of a template that moved, is gone, lost its chain or has no stamp is Discard only", () => {
		for (const reason of [
			"recurring_changed",
			"not_found",
			"chain_lost",
			"no_stamp",
		]) {
			expect(
				parkedFrom(template("update", reason, { title: "N" })).retryable,
			).toBe(false);
		}
	});

	it("an edit refused for another reason is sent again as it is", () => {
		for (const reason of ["bad_request", "internal_error"]) {
			const parked = parkedFrom(template("update", reason, { title: "N" }));
			expect(parked.retryable).toBe(true);
			expect(rebases(parked)).toBe(false);
		}
	});
});
