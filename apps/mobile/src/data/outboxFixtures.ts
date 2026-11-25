import type { DeviceBooking, NewOutboxEntry } from "./outbox";

// Entries for the outbox, sync and pending-source tests. Rows are cast: the
// tests care about the ids, the version and the text, not the whole row.

export const SENTINEL = {
	title: "SENTINEL-TITLE-9f3a",
	description: "SENTINEL-DESCRIPTION-9f3a",
	location: "SENTINEL-LOCATION-9f3a",
};

/** The text of a recurring template, and of the category joined onto it, that no entry may keep. */
export const TEMPLATE_SENTINEL = {
	name: "SENTINEL-NAME-7c1d",
	websiteUrl: "SENTINEL-WEBSITE-7c1d",
	paymentSource: "SENTINEL-SOURCE-7c1d",
	category: {
		id: "c1",
		name: "SENTINEL-CATEGORY-7c1d",
		color: "teal",
		icon: null,
	},
};

/** A template row as the engine stores it, with the text a caller may leave on by mistake. */
export function templateRow(
	id: string,
	over: Record<string, unknown> = {},
	withText = false,
) {
	return {
		id,
		amount: "20.00",
		currency: "USD",
		frequency: "MONTHLY",
		nextDueDate: new Date("2026-12-01T03:00:00.000Z"),
		anchorDay: 1,
		direction: "OUT",
		isActive: true,
		autoPay: true,
		amountMode: "FIXED",
		categoryId: "c1",
		version: null,
		...(withText ? TEMPLATE_SENTINEL : {}),
		...over,
	};
}

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
	table: "expenses" | "recurringTemplates" = "expenses",
): DeviceBooking {
	return {
		bookedAt: Date.parse("2026-10-15T14:59:00.000Z"),
		changes: [
			{
				table,
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
