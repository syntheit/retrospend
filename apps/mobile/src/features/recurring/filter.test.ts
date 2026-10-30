import {
	filterRecurring,
	isRecurringFiltered,
	NO_RECURRING_FILTER,
} from "./filter";
import type { RecurringItem } from "./source";

function item(title: string, autoPay: boolean, foreign = false) {
	return {
		title,
		autoPay,
		...(foreign ? { home: { currency: "ARS", minor: 1 } } : {}),
	} as unknown as RecurringItem;
}

const ITEMS = [
	item("Fibra e internet", false),
	item("Streamly", false, true),
	item("Gimnasio Fuerza", true),
];

describe("filterRecurring", () => {
	it("keeps everything with no filter", () => {
		expect(filterRecurring(ITEMS, NO_RECURRING_FILTER)).toHaveLength(3);
		expect(isRecurringFiltered(NO_RECURRING_FILTER)).toBe(false);
	});

	it("splits by auto-pay", () => {
		const on = filterRecurring(ITEMS, { ...NO_RECURRING_FILTER, autoPay: "on" });
		const off = filterRecurring(ITEMS, {
			...NO_RECURRING_FILTER,
			autoPay: "off",
		});
		expect(on.map((i) => i.title)).toEqual(["Gimnasio Fuerza"]);
		expect(off).toHaveLength(2);
	});

	it("keeps foreign templates only", () => {
		const out = filterRecurring(ITEMS, { ...NO_RECURRING_FILTER, foreign: true });
		expect(out.map((i) => i.title)).toEqual(["Streamly"]);
	});

	it("searches the name, ignoring case and accents", () => {
		const hit = filterRecurring(ITEMS, {
			...NO_RECURRING_FILTER,
			q: " GIMNÁSIO",
		});
		expect(hit.map((i) => i.title)).toEqual(["Gimnasio Fuerza"]);
		expect(
			filterRecurring(ITEMS, { ...NO_RECURRING_FILTER, q: "FIBRA" }),
		).toHaveLength(1);
	});
});
