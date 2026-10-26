import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EVENT_TYPES, isEventTypeName } from "@retrospend/api-contract";
import { describe, expect, it } from "vitest";
import { eventTypeOfMutation, MUTATION_EVENTS } from "./mutation-events";

/** The ids of every money mutation in the source tree. */
function mutationIds(dir = join(process.cwd(), "src")): string[] {
	const ids: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) ids.push(...mutationIds(path));
		else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
			const text = readFileSync(path, "utf8");
			// Only files that define a mutation: other files have ids of figures.
			if (/MoneyMutation</.test(text))
				for (const m of text.matchAll(/^\s*id: "([A-Za-z]+\.[A-Za-z.]+)",/gm))
					ids.push(m[1] as string);
		}
	}
	return ids;
}

/** Mutations that append no event of their own, and why. Empty is the goal. */
const NO_EVENT: Record<string, string> = {};

describe("MUTATION_EVENTS", () => {
	it("names only registered event types", () => {
		const registered = new Set<string>(EVENT_TYPES);
		for (const mutation of Object.keys(MUTATION_EVENTS)) {
			// A name that reads the result is tried with each result it reads.
			for (const value of [
				undefined,
				{ answer: "accept" },
				{ answer: "reject" },
			]) {
				const type = eventTypeOfMutation(mutation, value);
				expect(type, mutation).not.toBeNull();
				expect(isEventTypeName(type as string), mutation).toBe(true);
				expect(registered.has(type as string), `${mutation} -> ${type}`).toBe(
					true,
				);
			}
		}
	});

	it("covers every money mutation, so a write on the web is in the feed too", () => {
		const missing = mutationIds().filter(
			(id) => !(id in MUTATION_EVENTS) && !(id in NO_EVENT),
		);
		expect(missing).toEqual([]);
	});

	it("does not keep a mutation on the list that no longer exists", () => {
		const known = new Set(mutationIds());
		expect(Object.keys(NO_EVENT).filter((id) => !known.has(id))).toEqual([]);
		expect(Object.keys(MUTATION_EVENTS).filter((id) => !known.has(id))).toEqual(
			[],
		);
	});

	it("names accepting and rejecting a share differently", () => {
		expect(
			eventTypeOfMutation("sharedExpense.answerShare", { answer: "accept" }),
		).toBe("shared_expense.accepted");
		expect(
			eventTypeOfMutation("sharedExpense.answerShare", { answer: "reject" }),
		).toBe("shared_expense.rejected");
	});

	it("uses the v1 routes' names for corrections, fix requests and move-ins", () => {
		const named = (id: string) => eventTypeOfMutation(id, undefined);
		expect(named("correction.apply")).toBe("shared_expense.corrected");
		expect(named("correction.undo")).toBe("correction.undone");
		expect(named("fixRequest.ask")).toBe("fix_request.created");
		expect(named("fixRequest.respond")).toBe("fix_request.answered");
		expect(named("fixRequest.cancel")).toBe("fix_request.cancelled");
		expect(named("fixRequest.withdraw")).toBe("correction.undone");
		expect(named("fixRequest.restore")).toBe("correction.undone");
		expect(named("income.moveIn")).toBe("income.moved_in");
		expect(named("income.undoMoveIn")).toBe("income.undone");
		expect(named("project.membershipDates")).toBe("project.member_dates_set");
	});

	it("has no name for a mutation it does not know", () => {
		expect(eventTypeOfMutation("nothing.here", undefined)).toBeNull();
	});
});
