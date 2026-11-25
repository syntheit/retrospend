import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../packages/i18n/messages/en/activity.json";
import { movedMessage } from "./bulk-categorize-message";

const t = createTranslator({
	locale: "en",
	messages: { activity: en },
	namespace: "activity.bulk",
});

describe("movedMessage", () => {
	it("says what the server moved and how many it left alone, not what was picked", () => {
		// Three picked, the server moved two and skipped a spread parent.
		const text = movedMessage(
			t,
			{ updated: 2, skipped: [{ id: "parent", reason: "spread" }] },
			"Groceries",
		);
		expect(text).toBe("Moved 2 expenses to Groceries. 1 couldn't be moved");
	});

	it("is the plain sentence when nothing was skipped", () => {
		expect(movedMessage(t, { updated: 1, skipped: [] }, "Groceries")).toBe(
			"Moved 1 expense to Groceries",
		);
	});
});
