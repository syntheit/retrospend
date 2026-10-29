import { Alert } from "react-native";
import { replaceDraft } from "./replaceDraft";

const words = {
	title: "Replace this draft?",
	detail: "Lost.",
	keep: "Keep editing",
	replace: "Replace",
};

type Button = { text: string; onPress?: () => void };

describe("replaceDraft", () => {
	const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
	beforeEach(() => alert.mockClear());

	it("replaces an untouched composer at once", () => {
		const replace = jest.fn();
		replaceDraft(false, replace, words);
		expect(replace).toHaveBeenCalledTimes(1);
		expect(alert).not.toHaveBeenCalled();
	});

	it("asks before replacing unsaved changes, and keeps them unless told", () => {
		const replace = jest.fn();
		replaceDraft(true, replace, words);
		expect(replace).not.toHaveBeenCalled();
		const buttons = alert.mock.calls[0]?.[2] as Button[];
		expect(buttons.map((b) => b.text)).toEqual(["Keep editing", "Replace"]);
		buttons[0]?.onPress?.();
		expect(replace).not.toHaveBeenCalled();
		buttons[1]?.onPress?.();
		expect(replace).toHaveBeenCalledTimes(1);
	});
});
