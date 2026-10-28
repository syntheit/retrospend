import en from "@retrospend/i18n/messages/en/push.json";
import {
	deepLinkFor,
	PUSH_CHANNELS,
	PUSH_KINDS,
	parsePushPayload,
	pushKindOf,
	routeFor,
	textKeyOf,
} from "./kinds";

// PUSH_NOTIFICATION_TYPES of @retrospend/api-contract (its ESM dependencies
// do not load in jest); kinds.ts types each switch as a NotificationType.
const PUSH_SWITCHES = [
	"EXPENSE_SPLIT",
	"VERIFICATION_REQUEST",
	"EXPENSE_EDITED",
	"SETTLEMENT_RECEIVED",
	"SETTLEMENT_CONFIRMED",
	"SETTLEMENT_REJECTED",
	"PAYMENT_REMINDER",
	"RECURRING_DUE",
];

describe("push kinds", () => {
	it("maps every kind to a known channel, switch and text", () => {
		for (const [kind, info] of Object.entries(PUSH_KINDS)) {
			expect(PUSH_CHANNELS).toContain(info.channel);
			expect(PUSH_SWITCHES).toContain(info.preference);
			expect(en).toHaveProperty(info.textKey);
			expect(pushKindOf(kind)).toBe(kind);
		}
		// Every channel is used, so none is created for nothing.
		expect(new Set(Object.values(PUSH_KINDS).map((k) => k.channel))).toEqual(
			new Set(PUSH_CHANNELS),
		);
	});

	it("names the four Android channels the server names", () => {
		expect([...PUSH_CHANNELS]).toEqual([
			"splits",
			"payments",
			"reminders",
			"recurring",
		]);
		expect(PUSH_KINDS["payment.reminded"].channel).toBe("reminders");
		expect(PUSH_KINDS["recurring.due"].channel).toBe("recurring");
	});

	it("ignores types it does not know, including inherited names", () => {
		expect(pushKindOf("expense.created")).toBeNull();
		expect(pushKindOf("toString")).toBeNull();
	});

	it("words a recurring item by its direction", () => {
		expect(textKeyOf("recurring.due", "in")).toBe("recurringDueIn");
		expect(textKeyOf("recurring.due", "out")).toBe("recurringDueOut");
		expect(textKeyOf("recurring.due")).toBe("recurringDueOut");
		expect(textKeyOf("payment.recorded", "in")).toBe("paymentRecorded");
		expect(en).toHaveProperty("recurringDueIn");
	});
});

describe("payload to route", () => {
	const payload = (
		type: string,
		entity: unknown = { type: "x", id: "abc" },
	) => ({
		v: 1,
		type,
		channel: "splits",
		entity,
		ids: {},
		amount: null,
	});

	it("reads the object the server sends under `retrospend`", () => {
		expect(parsePushPayload(payload("shared_expense.created"))).toEqual({
			type: "shared_expense.created",
			channel: "splits",
			entity: { type: "x", id: "abc" },
		});
		expect(
			parsePushPayload({ ...payload("recurring.due"), direction: "in" }),
		).toMatchObject({ type: "recurring.due", direction: "in" });
	});

	it("rejects anything that is not ours", () => {
		expect(parsePushPayload(null)).toBeNull();
		expect(parsePushPayload("x")).toBeNull();
		expect(
			parsePushPayload({ ...payload("shared_expense.created"), v: 2 }),
		).toBeNull();
		expect(parsePushPayload(payload("expense.created"))).toBeNull();
	});

	it("opens Activity, People or Home", () => {
		expect(routeFor("shared_expense.created")).toBe("/activity");
		expect(routeFor("shared_expense.updated")).toBe("/activity");
		expect(routeFor("fix_request.created")).toBe("/activity");
		expect(routeFor("payment.recorded")).toBe("/people");
		expect(routeFor("payment.confirmed")).toBe("/people");
		expect(routeFor("payment.not_received")).toBe("/people");
		expect(routeFor("payment.reminded")).toBe("/people");
		expect(routeFor("recurring.due")).toBe("/home");
	});

	it("builds the link an Android notification opens", () => {
		expect(deepLinkFor("payment.reminded")).toBe("retrospend://people");
		expect(deepLinkFor("shared_expense.created")).toBe("retrospend://activity");
		expect(deepLinkFor("recurring.due")).toBe("retrospend://home");
	});
});
