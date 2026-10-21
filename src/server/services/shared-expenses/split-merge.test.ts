import { describe, expect, it, vi } from "vitest";
import { mergeOverlappingSplitRows } from "./split-merge";

/** Joins a tagged-template call back into SQL with $n placeholders. */
function sqlOf(call: unknown[]): { text: string; values: unknown[] } {
	const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
	const text = strings.reduce(
		(acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""),
		"",
	);
	return { text: text.replace(/\s+/g, " "), values };
}

describe("mergeOverlappingSplitRows", () => {
	it("sums percentage and units along with the amount", async () => {
		const tx = { $executeRaw: vi.fn(async () => 0) };

		await mergeOverlappingSplitRows(
			tx as never,
			{ participantType: "shadow", participantId: "ghost-1" },
			{ participantType: "user", participantId: "bob" },
		);

		expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
		const update = sqlOf(tx.$executeRaw.mock.calls[0] as unknown[]);
		expect(update.text).toContain(
			'"shareAmount" = target."shareAmount" + source."shareAmount"',
		);
		expect(update.text).toContain(
			'COALESCE(target."sharePercentage", 0) + COALESCE(source."sharePercentage", 0)',
		);
		expect(update.text).toContain(
			'COALESCE(target."shareUnits", 0) + COALESCE(source."shareUnits", 0)',
		);
		expect(update.values).toEqual(["shadow", "ghost-1", "user", "bob"]);

		const del = sqlOf(tx.$executeRaw.mock.calls[1] as unknown[]);
		expect(del.text).toContain("DELETE FROM split_participant");
		expect(del.values).toEqual(["shadow", "ghost-1", "user", "bob"]);
	});

	it("updates before deleting so the merged share is not lost", async () => {
		const order: string[] = [];
		const tx = {
			$executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
				order.push(strings[0]!.trim().split(/\s+/)[0]!);
				return 0;
			}),
		};

		await mergeOverlappingSplitRows(
			tx as never,
			{ participantType: "guest", participantId: "g-1" },
			{ participantType: "user", participantId: "u-1" },
		);

		expect(order).toEqual(["UPDATE", "DELETE"]);
	});
});
