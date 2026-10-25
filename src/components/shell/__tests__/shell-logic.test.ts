import { describe, expect, it } from "vitest";
import {
	filterNotifications,
	historyTransactionId,
	isNotificationFilter,
	notificationHref,
} from "../notification-data";
import { goToItems } from "../palette-items";

describe("notifications", () => {
	const n = (type: string, data: unknown = {}) => ({ type, data }) as never;

	it("filters by kind like today's bell", () => {
		const items = [
			n("EXPENSE_SPLIT"),
			n("SETTLEMENT_RECEIVED"),
			n("PERIOD_CLOSED"),
			n("PAYMENT_REMINDER"),
			n("VERIFICATION_REQUEST"),
		] as { type: string }[];
		const types = (f: Parameters<typeof filterNotifications>[1]) =>
			filterNotifications(items as never[], f).map(
				(x: { type: string }) => x.type,
			);
		expect(types("all")).toHaveLength(5);
		expect(types("expenses")).toEqual(["EXPENSE_SPLIT"]);
		expect(types("settlements")).toEqual([
			"SETTLEMENT_RECEIVED",
			"PAYMENT_REMINDER",
		]);
		expect(types("projects")).toEqual([
			"PERIOD_CLOSED",
			"VERIFICATION_REQUEST",
		]);
	});

	it("reads a stored filter only when it is one of the four", () => {
		expect(isNotificationFilter("settlements")).toBe(true);
		expect(isNotificationFilter("bogus")).toBe(false);
		expect(isNotificationFilter(null)).toBe(false);
	});

	it("opens the related person or project", () => {
		expect(
			notificationHref(
				n("EXPENSE_SPLIT", { actorType: "user", actorId: "u1" }),
			),
		).toBe("/people/user/u1");
		expect(notificationHref(n("EXPENSE_EDITED", {}))).toBe("/people");
		expect(
			notificationHref(
				n("SETTLEMENT_CONFIRMED", {
					toParticipantType: "shadow",
					toParticipantId: "s1",
				}),
			),
		).toBe("/people/shadow/s1");
		expect(
			notificationHref(
				n("PAYMENT_REMINDER", {
					fromParticipantType: "user",
					fromParticipantId: "u2",
				}),
			),
		).toBe("/people/user/u2");
		expect(notificationHref(n("PERIOD_CLOSED", { projectId: "p1" }))).toBe(
			"/projects/p1",
		);
		expect(notificationHref(n("PARTICIPANT_ADDED", {}))).toBe("/projects");
		expect(notificationHref(n("EXPENSE_SPLIT", null))).toBeNull();
	});

	it("opens the revision history for edited and deleted expenses only", () => {
		expect(
			historyTransactionId(n("EXPENSE_EDITED", { transactionId: "t1" })),
		).toBe("t1");
		expect(
			historyTransactionId(n("EXPENSE_DELETED", { transactionId: "t2" })),
		).toBe("t2");
		expect(
			historyTransactionId(n("EXPENSE_SPLIT", { transactionId: "t3" })),
		).toBeNull();
	});
});

describe("palette Go to", () => {
	it("lists each place's current route, Insights and Recurring included", () => {
		const items = goToItems(false);
		expect(items.map((i) => i.href)).toEqual([
			"/home",
			"/activity",
			"/budget",
			"/people",
			"/projects",
			"/wealth",
			"/import",
			"/currencies",
			"/settings",
			"/activity/recurring",
			"/activity/insights",
		]);
	});

	it("adds the Settings sections once the person types", () => {
		const sections = goToItems(true).filter((i) => i.label.section);
		expect(sections.map((i) => i.href)).toEqual([
			"/settings#profile",
			"/settings#preferences",
			"/settings#categories",
			"/settings#payment",
			"/settings#notifications",
			"/settings#security",
			"/settings#data",
		]);
	});
});
