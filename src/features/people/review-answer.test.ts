import { describe, expect, it } from "vitest";
import {
	answerInput,
	failureSentence,
	reasonOf,
	undoTokenOf,
} from "./review-answer";

const token = { data: "{}", sig: "0".repeat(64) };

describe("answerInput", () => {
	it("previews Accept by default and Reject on the reject step", () => {
		expect(answerInput("t1", false)).toEqual({ txnId: "t1", answer: "accept" });
		expect(answerInput("t1", true)).toEqual({ txnId: "t1", answer: "reject" });
	});

	it("carries no reason, so typing one does not run the dry run again", () => {
		expect(Object.keys(answerInput("t1", true))).toEqual(["txnId", "answer"]);
	});
});

describe("reasonOf", () => {
	it("sends what was typed, spaces and all", () => {
		expect(reasonOf("  No era mío ")).toBe("  No era mío ");
	});

	it("leaves out a reason that is only whitespace or empty", () => {
		expect(reasonOf("")).toBeUndefined();
		expect(reasonOf(" \n\t ")).toBeUndefined();
	});
});

describe("failureSentence", () => {
	const refused = (code: string) => `refused ${code}`;

	it("says the refusal's own sentence for a problem code", () => {
		expect(
			failureSentence(
				{ data: { problem: "share_locked" } },
				refused,
				"generic",
			),
		).toBe("refused share_locked");
	});

	it("never shows the server's text for anything else", () => {
		expect(failureSentence(new Error("boom"), refused, "generic")).toBe(
			"generic",
		);
		expect(
			failureSentence({ data: { problem: "other" } }, refused, "generic"),
		).toBe("generic");
	});
});

describe("undoTokenOf", () => {
	it("offers the token only when the answer changed the share", () => {
		expect(undoTokenOf({ changed: true, restore: token })).toBe(token);
		expect(undoTokenOf({ changed: false, restore: null })).toBeNull();
		expect(undoTokenOf({ changed: true, restore: null })).toBeNull();
	});
});
