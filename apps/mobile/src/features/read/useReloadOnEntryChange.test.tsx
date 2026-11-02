import { createElement } from "react";
import { announceEntryChange } from "@/features/entry/events";
import { useReloadOnEntryChange } from "./useReloadOnEntryChange";

// A screen reloads on an entry change only while it is in front: a tab kept
// warm behind another waits and asks when it regains focus.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

let mockFocused: (() => (() => void) | undefined) | null = null;

jest.mock("expo-router", () => ({
	useFocusEffect: (effect: () => (() => void) | undefined) => {
		mockFocused = effect;
		require("react").useEffect(effect, [effect]);
	},
}));

function mount(reload: () => void) {
	const Probe = () => {
		useReloadOnEntryChange(reload);
		return null;
	};
	let tree: { unmount(): void };
	act(() => {
		tree = create(createElement(Probe));
	});
	// biome-ignore lint/style/noNonNullAssertion: assigned in act
	return tree!;
}

describe("useReloadOnEntryChange", () => {
	it("reloads when an entry changes while the screen is in front", () => {
		const reload = jest.fn();
		const tree = mount(reload);
		act(() => announceEntryChange());
		expect(reload).toHaveBeenCalledTimes(1);
		act(() => tree.unmount());
	});

	it("does not reload while the screen is behind another, and does once it is back", () => {
		const reload = jest.fn();
		const tree = mount(reload);
		// Leaving the screen runs the focus effect's cleanup.
		const leave = mockFocused?.();
		act(() => leave?.());
		act(() => announceEntryChange());
		expect(reload).not.toHaveBeenCalled();
		act(() => {
			mockFocused?.();
		});
		act(() => announceEntryChange());
		expect(reload).toHaveBeenCalledTimes(1);
		act(() => tree.unmount());
	});

	it("stops listening when the screen goes away", () => {
		const reload = jest.fn();
		const tree = mount(reload);
		act(() => tree.unmount());
		announceEntryChange();
		expect(reload).not.toHaveBeenCalled();
	});
});
