import { Dimensions } from "react-native";
import { SheetContext, usePinnedAction, useSheetFill } from "./sheetContext";

// A form hands its primary action to the sheet's pinned footer; outside a
// sheet it keeps its own button. A body flexes where the sheet hands it its
// height, and is bounded to its detent elsewhere.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));

function Form({
	label,
	disabled,
	onPress,
	seen,
}: {
	label: string;
	disabled: boolean;
	onPress: () => void;
	seen: { pinned?: boolean };
}) {
	seen.pinned = usePinnedAction({ label, disabled, onPress });
	return null;
}

function Fill({ out }: { out: { fill?: ReturnType<typeof useSheetFill> } }) {
	out.fill = useSheetFill();
	return null;
}

describe("usePinnedAction", () => {
	it("hands the action up and keeps the latest press", () => {
		const pin = jest.fn();
		const first = jest.fn();
		const second = jest.fn();
		const seen: { pinned?: boolean } = {};
		let tree: { update(next: unknown): void; unmount(): void } | undefined;
		act(() => {
			tree = create(
				<SheetContext.Provider value={{ detent: "large", pin }}>
					<Form disabled label="Save" onPress={first} seen={seen} />
				</SheetContext.Provider>,
			);
		});
		expect(seen.pinned).toBe(true);
		expect(pin).toHaveBeenLastCalledWith(
			expect.objectContaining({ label: "Save", disabled: true }),
		);
		// A new handler does not re-pin; the pinned press calls the latest one.
		const calls = pin.mock.calls.length;
		act(() => {
			tree?.update(
				<SheetContext.Provider value={{ detent: "large", pin }}>
					<Form disabled label="Save" onPress={second} seen={seen} />
				</SheetContext.Provider>,
			);
		});
		expect(pin.mock.calls.length).toBe(calls);
		pin.mock.calls[calls - 1][0].onPress();
		expect(second).toHaveBeenCalledTimes(1);
		expect(first).not.toHaveBeenCalled();
		act(() => tree?.unmount());
		expect(pin).toHaveBeenLastCalledWith(null);
	});

	it("leaves the button to the form outside a sheet", () => {
		const seen: { pinned?: boolean } = {};
		act(() => {
			create(
				<Form disabled={false} label="Save" onPress={() => {}} seen={seen} />,
			);
		});
		expect(seen.pinned).toBe(false);
	});
});

describe("useSheetFill", () => {
	const fillIn = (detent: "medium" | "large" | null, fills = false) => {
		const out: { fill?: ReturnType<typeof useSheetFill> } = {};
		act(() => {
			create(
				<SheetContext.Provider value={{ detent, fills, pin: () => {} }}>
					<Fill out={out} />
				</SheetContext.Provider>,
			);
		});
		return out.fill as ReturnType<typeof useSheetFill>;
	};

	it("flexes into the sheet's own height where the sheet hands it over", () => {
		expect(fillIn("medium", true)).toEqual({ flex: 1, minHeight: 0 });
		expect(fillIn("large", true)).toEqual({ flex: 1, minHeight: 0 });
	});

	it("keeps a medium body inside half the window", () => {
		const medium = fillIn("medium");
		expect(medium.maxHeight).toBe(medium.minHeight);
		expect(medium.minHeight).toBeLessThan(Dimensions.get("window").height / 2);
	});

	it("bounds a large body to most of the window, so a long list scrolls", () => {
		const large = fillIn("large");
		expect(large.maxHeight).toBe(large.minHeight);
		const window = Dimensions.get("window").height;
		expect(large.minHeight).toBeGreaterThan(window / 2);
		expect(large.minHeight).toBeLessThan(window * 0.8);
	});
});
