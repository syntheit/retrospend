import { closeTransients, useTransient } from "./transient";

// Passing UI registers its close only while open, and a tab switch closes it.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

function Probe({ close }: { close: (() => void) | null }) {
	useTransient(close);
	return null;
}

describe("transient", () => {
	it("closes what is open and forgets what closed", () => {
		const close = jest.fn();
		let tree!: { update(el: unknown): void; unmount(): void };
		act(() => {
			tree = create(<Probe close={close} />);
		});
		act(() => closeTransients());
		expect(close).toHaveBeenCalledTimes(1);
		act(() => tree.update(<Probe close={null} />));
		act(() => closeTransients());
		expect(close).toHaveBeenCalledTimes(1);
		act(() => tree.update(<Probe close={close} />));
		act(() => tree.unmount());
		act(() => closeTransients());
		expect(close).toHaveBeenCalledTimes(1);
	});
});
