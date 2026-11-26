import type { ActivityItem } from "@/features/activity/source";
import { templateBody } from "./makeRecurring";

// The monthly anchor is the domain's rule (anchorOf), not a copy of its
// slice: the phone and the engine must read a day the same way. A stand-in
// that answers 7 for every day shows which one the body asks.
jest.mock("@retrospend/domain/recurring-post/template", () => ({
	anchorOf: () => 7,
}));

const item = {
	id: "a",
	source: "personal",
	entityId: "ea",
	kind: "expense",
	title: "Streamly",
	category: null,
	amount: { minor: 1000, currency: "ARS" },
	sortKey: 1000,
	project: null,
	date: "2026-01-31",
	mine: true,
	locked: false,
	canEdit: true,
} as unknown as ActivityItem;

it("takes the anchor day from the domain's anchorOf", () => {
	expect(templateBody(item).anchorDay).toBe(7);
});
