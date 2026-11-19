import type { DeviceBooking, NewOutboxEntry } from "./outbox";

// Entries for the outbox, sync and pending-source tests. Rows are cast: the
// tests care about the ids, the version and the text, not the whole row.

export const SENTINEL = {
	title: "SENTINEL-TITLE-9f3a",
	description: "SENTINEL-DESCRIPTION-9f3a",
	location: "SENTINEL-LOCATION-9f3a",
};

/** A booked USD expense row as the device keeps it, with text a caller may leave on by mistake. */
export function bookedRow(
	id: string,
	over: Record<string, unknown> = {},
	withText = false,
) {
	return {
		id,
		date: new Date("2026-10-05T03:00:00.000Z"),
		currency: "USD",
		amount: "100.00",
		amountInUSD: "100.00",
		homeAmount: "154500.00",
		version: null,
		...(withText ? SENTINEL : {}),
		...over,
	};
}

export function booking(
	id: string,
	before: Record<string, unknown> | null,
	after: Record<string, unknown> | null,
	over: Partial<DeviceBooking> = {},
): DeviceBooking {
	return {
		bookedAt: Date.parse("2026-10-15T14:59:00.000Z"),
		changes: [
			{
				table: "expenses",
				id,
				before: before as never,
				after: after as never,
			},
		],
		changed: ["amount"],
		...over,
	};
}

export const create = (id: string, device?: DeviceBooking): NewOutboxEntry => ({
	clientId: id,
	entity: "expenses",
	kind: "create",
	targetId: id,
	baseVersion: null,
	payload: { id },
	...(device ? { device } : {}),
});

/** An edit of `target`; `base` is a version or the entry it follows. */
export const edit = (
	clientId: string,
	target: string,
	base: NewOutboxEntry["baseVersion"],
	device?: DeviceBooking,
): NewOutboxEntry => ({
	clientId,
	entity: "expenses",
	kind: "update",
	targetId: target,
	baseVersion: base,
	payload: { id: target },
	...(device ? { device } : {}),
});
