import { backConsumerCount, useBackConsumer, useHasBackConsumer } from "./backConsumers";

// Search views mark themselves as back consumers; the back preview reads the
// flag and stands down while any is active.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

function Consumer({ active }: { active: boolean }) {
	useBackConsumer(active);
	return null;
}

let seen = false;
function Reader() {
	seen = useHasBackConsumer();
	return null;
}

describe("back consumers", () => {
	it("counts consumers while they are active and follows the flag", () => {
		let reader: { unmount: () => void } | undefined;
		act(() => {
			reader = create(<Reader />);
		});
		expect(seen).toBe(false);

		let one!: { update: (el: unknown) => void; unmount: () => void };
		let two!: { unmount: () => void };
		act(() => {
			one = create(<Consumer active />);
			two = create(<Consumer active />);
		});
		expect(seen).toBe(true);
		expect(backConsumerCount()).toBe(2);

		act(() => one.unmount());
		expect(seen).toBe(true);
		act(() => two.unmount());
		expect(seen).toBe(false);
		expect(backConsumerCount()).toBe(0);

		let flag!: { update: (el: unknown) => void; unmount: () => void };
		act(() => {
			flag = create(<Consumer active={false} />);
		});
		expect(seen).toBe(false);
		act(() => flag.update(<Consumer active />));
		expect(seen).toBe(true);
		act(() => flag.update(<Consumer active={false} />));
		expect(seen).toBe(false);
		act(() => {
			flag.unmount();
			reader?.unmount();
		});
	});
});
