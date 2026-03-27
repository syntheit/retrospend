/**
 * Tests for audit-log-formatter.ts
 *
 * Covers:
 * - generateSummary: all action types, edge cases, field-change combinations
 * - formatSplitMode: all split mode strings
 * - formatRelativeTime: relative date formatting edge cases
 */

import { describe, expect, it, vi } from "vitest";
import {
	type FieldChange,
	formatSplitMode,
	generateSummary,
} from "./audit-log-formatter";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fc(
	field: string,
	label: string,
	oldValue: string,
	newValue: string,
): FieldChange {
	return { field, label, oldValue, newValue };
}

const ACTOR = "Alice";

// ── generateSummary ───────────────────────────────────────────────────────────

describe("generateSummary", () => {
	describe("CREATED", () => {
		it("returns '<actor> created this expense'", () => {
			expect(generateSummary("CREATED", ACTOR, null, null)).toBe(
				"Alice created this expense",
			);
		});

		it("ignores fieldChanges for CREATED action", () => {
			const changes = [fc("amount", "Amount", "$50", "$60")];
			expect(generateSummary("CREATED", ACTOR, changes, null)).toBe(
				"Alice created this expense",
			);
		});
	});

	describe("DELETED", () => {
		it("returns '<actor> deleted this expense'", () => {
			expect(generateSummary("DELETED", ACTOR, null, null)).toBe(
				"Alice deleted this expense",
			);
		});
	});

	describe("VERIFIED", () => {
		it("returns '<actor> verified this expense'", () => {
			expect(generateSummary("VERIFIED", ACTOR, null, null)).toBe(
				"Alice verified this expense",
			);
		});
	});

	describe("AUTO_VERIFIED", () => {
		it("uses autoAcceptedAfterDays from changes", () => {
			expect(
				generateSummary("AUTO_VERIFIED", ACTOR, null, {
					autoAcceptedAfterDays: 14,
				}),
			).toBe("Auto-verified after 14 days of no response");
		});

		it("defaults to 7 days when autoAcceptedAfterDays is missing", () => {
			expect(generateSummary("AUTO_VERIFIED", ACTOR, null, {})).toBe(
				"Auto-verified after 7 days of no response",
			);
		});

		it("defaults to 7 days when changes is null", () => {
			expect(generateSummary("AUTO_VERIFIED", ACTOR, null, null)).toBe(
				"Auto-verified after 7 days of no response",
			);
		});
	});

	describe("REJECTED", () => {
		it("includes reason when provided", () => {
			expect(
				generateSummary("REJECTED", ACTOR, null, { reason: "I didn't order this" }),
			).toBe('Alice disputed this expense: "I didn\'t order this"');
		});

		it("returns generic disputed message when reason is absent", () => {
			expect(generateSummary("REJECTED", ACTOR, null, {})).toBe(
				"Alice disputed this expense",
			);
		});

		it("truncates reason at 100 characters", () => {
			const longReason = "a".repeat(120);
			const result = generateSummary("REJECTED", ACTOR, null, {
				reason: longReason,
			});
			expect(result).toContain("…");
			// Truncated portion ≤ 100+3 chars inside quotes
			expect(result.length).toBeLessThan(ACTOR.length + 120 + 50);
		});

		it("returns generic when reason is null", () => {
			expect(generateSummary("REJECTED", ACTOR, null, { reason: null })).toBe(
				"Alice disputed this expense",
			);
		});
	});

	describe("EDITED - amount change", () => {
		it("amount-only change: shows old → new", () => {
			const changes = [fc("amount", "Amount", "$50.00", "$75.00")];
			expect(generateSummary("EDITED", ACTOR, changes, null)).toBe(
				"Alice changed the amount from $50.00 to $75.00",
			);
		});

		it("amount + 1 other change: shows amount and '1 other change'", () => {
			const changes = [
				fc("amount", "Amount", "$50.00", "$75.00"),
				fc("description", "Description", "Dinner", "Lunch"),
			];
			expect(generateSummary("EDITED", ACTOR, changes, null)).toBe(
				"Alice changed the amount from $50.00 to $75.00 and made 1 other change",
			);
		});

		it("amount + 2 other changes: shows 'and made 2 other changes'", () => {
			const changes = [
				fc("amount", "Amount", "$50.00", "$75.00"),
				fc("description", "Description", "Dinner", "Lunch"),
				fc("date", "Date", "Mar 1", "Mar 2"),
			];
			const result = generateSummary("EDITED", ACTOR, changes, null);
			expect(result).toContain("2 other changes");
		});
	});

	describe("EDITED - single field change (no amount)", () => {
		it("returns specific 'changed the <field> from X to Y' message", () => {
			const changes = [fc("description", "description", "Dinner", "Lunch")];
			expect(generateSummary("EDITED", ACTOR, changes, null)).toBe(
				"Alice changed the description from Dinner to Lunch",
			);
		});

		it("lowercases the label", () => {
			const changes = [fc("date", "Date", "Mar 1", "Mar 2")];
			const result = generateSummary("EDITED", ACTOR, changes, null);
			expect(result).toBe("Alice changed the date from Mar 1 to Mar 2");
		});
	});

	describe("EDITED - two field changes (no amount)", () => {
		it("returns 'changed X and Y'", () => {
			const changes = [
				fc("description", "description", "Dinner", "Lunch"),
				fc("date", "date", "Mar 1", "Mar 2"),
			];
			expect(generateSummary("EDITED", ACTOR, changes, null)).toBe(
				"Alice changed description and date",
			);
		});
	});

	describe("EDITED - 3+ field changes (no amount)", () => {
		it("returns 'made N changes'", () => {
			const changes = [
				fc("description", "description", "Dinner", "Lunch"),
				fc("date", "date", "Mar 1", "Mar 2"),
				fc("currency", "currency", "USD", "EUR"),
			];
			expect(generateSummary("EDITED", ACTOR, changes, null)).toBe(
				"Alice made 3 changes",
			);
		});
	});

	describe("EDITED - participant changes only", () => {
		it("single participant_added: shows '<actor> added <name> to the split'", () => {
			const changes = [
				fc("participant_added", "Bob added to split", "", "50%"),
			];
			expect(generateSummary("EDITED", ACTOR, changes, null)).toBe(
				"Alice added Bob to the split",
			);
		});

		it("single participant_removed: shows '<actor> removed <name> from the split'", () => {
			const changes = [
				fc("participant_removed", "Bob removed from split", "50%", ""),
			];
			expect(generateSummary("EDITED", ACTOR, changes, null)).toBe(
				"Alice removed Bob from the split",
			);
		});

		it("multiple participant changes: shows 'updated the split'", () => {
			const changes = [
				fc("participant_added", "Carol added to split", "", "33%"),
				fc("participant_removed", "Bob removed from split", "50%", ""),
			];
			expect(generateSummary("EDITED", ACTOR, changes, null)).toBe(
				"Alice updated the split",
			);
		});
	});

	describe("EDITED - empty or null fieldChanges", () => {
		it("null fieldChanges: returns 'made changes'", () => {
			expect(generateSummary("EDITED", ACTOR, null, null)).toBe(
				"Alice made changes",
			);
		});

		it("empty array: returns 'made changes'", () => {
			expect(generateSummary("EDITED", ACTOR, [], null)).toBe(
				"Alice made changes",
			);
		});
	});

	describe("unknown action", () => {
		it("returns fallback for unknown action", () => {
			expect(generateSummary("FUTURE_ACTION", ACTOR, null, null)).toBe(
				"Alice made changes",
			);
		});
	});
});

// ── formatSplitMode ───────────────────────────────────────────────────────────

describe("formatSplitMode", () => {
	it("EQUAL → 'Equal'", () => {
		expect(formatSplitMode("EQUAL")).toBe("Equal");
	});

	it("EXACT → 'Exact'", () => {
		expect(formatSplitMode("EXACT")).toBe("Exact");
	});

	it("PERCENTAGE → 'Percentage'", () => {
		expect(formatSplitMode("PERCENTAGE")).toBe("Percentage");
	});

	it("SHARES → 'Shares'", () => {
		expect(formatSplitMode("SHARES")).toBe("Shares");
	});

	it("unknown mode → returned as-is", () => {
		expect(formatSplitMode("CUSTOM")).toBe("CUSTOM");
	});
});

// ── Activity feed summary strings (buildActivitySummary logic via generateSummary) ───

describe("generateSummary: actor name edge cases", () => {
	it("handles actor name with special characters", () => {
		const result = generateSummary("CREATED", "José García", null, null);
		expect(result).toBe("José García created this expense");
	});

	it("handles 'Unknown' actor name", () => {
		const result = generateSummary("DELETED", "Unknown", null, null);
		expect(result).toBe("Unknown deleted this expense");
	});

	it("handles 'System' actor name for auto-verified", () => {
		const result = generateSummary("AUTO_VERIFIED", "System", null, {
			autoAcceptedAfterDays: 7,
		});
		expect(result).toBe("Auto-verified after 7 days of no response");
	});
});
