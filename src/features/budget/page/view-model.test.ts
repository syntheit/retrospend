import { describe, expect, it } from "vitest";
import type {
	EnvelopeGroupDto,
	EnvelopeRowDto,
	GetMonthOutput,
} from "~/lib/schemas/envelope";
import {
	countStatus,
	filterGroups,
	groupStartsOpen,
	isFiltered,
	namesById,
	pickNotice,
	toEnvelopeVM,
} from "./view-model";

const ars = (minor: number) => ({ minor, currency: "ARS" });

function envelope(
	id: string,
	name: string,
	status: EnvelopeRowDto["status"],
	left = 0,
): EnvelopeRowDto {
	return {
		id,
		name,
		icon: null,
		color: null,
		kind: "MONTHLY",
		groupId: null,
		isDefault: false,
		sortOrder: 0,
		categoryIds: [],
		carryIn: ars(0),
		assigned: ars(0),
		activity: ars(0),
		spent: ars(0),
		spentBasis: 0,
		left: ars(left),
		pending: ars(0),
		status,
		target: null,
		leftThisWeek: null,
	};
}

function group(
	role: EnvelopeGroupDto["role"],
	envelopes: EnvelopeRowDto[],
): EnvelopeGroupDto {
	return {
		id: role ?? "none",
		name: null,
		role,
		sortOrder: 0,
		totals: {
			carryIn: ars(0),
			assigned: ars(0),
			activity: ars(0),
			spent: ars(0),
			left: ars(0),
			over: ars(0),
			need: ars(0),
			count: envelopes.length,
		},
		envelopes,
	};
}

const groups = [
	group("BILLS", [
		envelope("rent", "Rent", "FUNDED"),
		envelope("net", "Netflix", "OVERSPENT", -8500),
	]),
	group("SPENDING", [envelope("food", "Groceries", "UNDERFUNDED")]),
];

/** Only what pickNotice reads. */
function month(notice: GetMonthOutput["verdict"]["notice"], over: string[]) {
	return {
		verdict: {
			notice,
			overEnvelopes: over.map((id) => ({ id, over: ars(100) })),
		},
	} as unknown as GetMonthOutput;
}

describe("toEnvelopeVM", () => {
	it("keeps the server's amount and maps the status words", () => {
		const vm = toEnvelopeVM(envelope("net", "Netflix", "OVERSPENT", -8500));
		expect(vm.available).toEqual(ars(-8500));
		expect(vm.status).toBe("overspent");
		// No spent share from the server yet: no bar.
		expect(vm.spent).toBeUndefined();
	});

	it("reads a no-target envelope as fine", () => {
		expect(toEnvelopeVM(envelope("x", "X", "NO_TARGET")).status).toBe("funded");
	});
});

describe("filters", () => {
	it("narrows by name and drops groups left empty", () => {
		const f = filterGroups(groups, { query: "netf", chip: null });
		expect(f.map((g) => g.role)).toEqual(["BILLS"]);
		expect(f[0]?.envelopes.map((e) => e.id)).toEqual(["net"]);
	});

	it("narrows by status chip and counts each status", () => {
		const f = filterGroups(groups, { query: "", chip: "underfunded" });
		expect(f.map((g) => g.role)).toEqual(["SPENDING"]);
		expect(countStatus(groups, "overspent")).toBe(1);
		expect(countStatus(groups, "underfunded")).toBe(1);
	});

	it("leaves the list whole without a filter", () => {
		expect(isFiltered({ query: " ", chip: null })).toBe(false);
		expect(filterGroups(groups, { query: "", chip: null })).toHaveLength(2);
	});
});

describe("groupStartsOpen", () => {
	const spending = group("SPENDING", []);
	it("folds each group in Flex and Save first", () => {
		expect(groupStartsOpen("FLEX", spending)).toBe(false);
		expect(groupStartsOpen("SAVE_FIRST", spending)).toBe(false);
	});
	it("opens every group in Every dollar and Limits, and Spending in Weekly", () => {
		expect(groupStartsOpen("EVERY_DOLLAR", spending)).toBe(true);
		expect(groupStartsOpen("LIMITS", spending)).toBe(true);
		expect(groupStartsOpen("WEEKLY", spending)).toBe(true);
		expect(groupStartsOpen("WEEKLY", group("BILLS", []))).toBe(false);
	});
});

describe("pickNotice", () => {
	const names = namesById(groups);
	const overspent = {
		kind: "OVERSPENT" as const,
		amount: ars(100),
		action: "COVER" as const,
	};

	it("puts coming back before everything", () => {
		const n = pickNotice(
			month(overspent, ["net"]),
			{ pending: true, months: [{ month: 202609, acknowledged: false }] },
			names,
		);
		expect(n).toEqual({ kind: "welcomeBack" });
	});

	it("then an unread closed month", () => {
		const n = pickNotice(
			month(overspent, ["net"]),
			{ pending: false, months: [{ month: 202609, acknowledged: false }] },
			names,
		);
		expect(n).toEqual({ kind: "summary", month: 202609 });
	});

	it("then the verdict's own, naming one envelope or counting several", () => {
		expect(pickNotice(month(overspent, ["net"]), null, names)).toEqual({
			kind: "overspent",
			count: 1,
			name: "Netflix",
		});
		expect(pickNotice(month(overspent, ["net", "food"]), null, names)).toEqual({
			kind: "overspent",
			count: 2,
			name: null,
		});
	});

	it("shows nothing when nothing needs you", () => {
		expect(pickNotice(month(null, []), undefined, names)).toBeNull();
	});
});
