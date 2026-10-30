import { useLinkedEntry } from "./linkedEntry";

// Picking another row lets go of the link, so the same link again is a change.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

const mockParams: { select?: string; row?: string } = {};
const mockSetParams = jest.fn();
jest.mock("expo-router", () => ({
	useLocalSearchParams: () => mockParams,
	router: { setParams: (next: unknown) => mockSetParams(next) },
}));

type Out = { current: ReturnType<typeof useLinkedEntry> | null };

function Probe({ out }: { out: Out }) {
	out.current = useLinkedEntry();
	return null;
}

describe("useLinkedEntry", () => {
	it("clears the link's params on release, and only while a link is set", () => {
		const out: Out = { current: null };
		mockParams.select = "e1";
		let tree: { unmount(): void } | undefined;
		act(() => {
			tree = create(<Probe out={out} />);
		});
		expect(out.current?.link?.id).toBe("e1");
		out.current?.release();
		expect(mockSetParams).toHaveBeenCalledWith({
			select: undefined,
			row: undefined,
		});
		mockSetParams.mockClear();
		mockParams.select = undefined;
		act(() => {
			tree?.unmount();
			tree = create(<Probe out={out} />);
		});
		expect(out.current?.link).toBeNull();
		out.current?.release();
		expect(mockSetParams).not.toHaveBeenCalled();
		act(() => tree?.unmount());
	});
});
