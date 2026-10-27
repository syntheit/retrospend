import { Keyboard } from "react-native";
import { useKeyboardHeight } from "./useKeyboardHeight";

// The keyboard's height follows its show and hide events, and an off switch
// listens to nothing.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

type Handler = (event: { endCoordinates: { height: number } }) => void;
const handlers = new Map<string, Handler>();

function Probe({ enabled, out }: { enabled?: boolean; out: number[] }) {
	out.push(useKeyboardHeight(enabled));
	return null;
}

describe("useKeyboardHeight", () => {
	beforeEach(() => {
		handlers.clear();
		jest
			.spyOn(Keyboard, "addListener")
			.mockImplementation((name: string, handler: unknown) => {
				handlers.set(name, handler as Handler);
				return { remove: jest.fn() } as never;
			});
	});

	it("is the keyboard's height while it is up, 0 after", () => {
		const out: number[] = [];
		act(() => {
			create(<Probe out={out} />);
		});
		expect(out.at(-1)).toBe(0);
		act(() =>
			handlers.get("keyboardWillShow")?.({ endCoordinates: { height: 336 } }),
		);
		expect(out.at(-1)).toBe(336);
		act(() =>
			handlers.get("keyboardWillHide")?.({ endCoordinates: { height: 0 } }),
		);
		expect(out.at(-1)).toBe(0);
	});

	it("listens to nothing when it is off", () => {
		act(() => {
			create(<Probe enabled={false} out={[]} />);
		});
		expect(handlers.size).toBe(0);
	});
});
