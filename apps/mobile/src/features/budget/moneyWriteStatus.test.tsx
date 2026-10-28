import { type PreviewStatus, useMoneyWrite } from "./useMoneyWrite";

const renderer = require("react-test-renderer");
const { act } = renderer;

const settle = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 5));
	});

// Every status the hook handed to a render, in order.
function Probe({ amount, seen }: { amount: number; seen: string[] }) {
	const flow = useMoneyWrite({
		input: { amount },
		idempotencyKey: "k",
		preview: async () => ({ amount }),
		write: async () => ({ undo: null }),
		debounceMs: 0,
	});
	seen.push(`${amount}:${flow.status satisfies PreviewStatus}`);
	return null;
}

describe("preview status", () => {
	it("is not ready on the frame after the body changes", async () => {
		const seen: string[] = [];
		let tree: { update(el: unknown): void } | undefined;
		act(() => {
			tree = renderer.create(<Probe amount={1} seen={seen} />);
		});
		await settle();
		expect(seen[seen.length - 1]).toBe("1:ready");
		seen.length = 0;
		act(() => {
			tree?.update(<Probe amount={2} seen={seen} />);
		});
		// The first render with the new body must not carry the old answer.
		expect(seen[0]).toBe("2:loading");
		await settle();
		expect(seen[seen.length - 1]).toBe("2:ready");
	});
});
