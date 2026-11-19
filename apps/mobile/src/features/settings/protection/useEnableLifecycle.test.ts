// The hook's wiring, without a renderer: `useRef` and `useEffect` are replaced
// by a few lines that run effects the way React does (on mount, when a
// dependency changed, cleanup on unmount), so the calls from the effects into
// the controller are what is tested. The controller's own rules are in
// packages/crypto/test/client-enable-lifecycle.test.ts.

type Effect = { deps: unknown[]; cleanup?: () => void };
const mockReact = {
	cursor: 0,
	refs: [] as { current: unknown }[],
	effects: [] as (Effect | undefined)[],
	pending: [] as (() => void)[],
};

jest.mock("react", () => ({
	...jest.requireActual("react"),
	useRef: (initial: unknown) => {
		const at = mockReact.cursor++;
		mockReact.refs[at] ??= { current: initial };
		return mockReact.refs[at];
	},
	useEffect: (effect: () => undefined | (() => void), deps: unknown[]) => {
		const at = mockReact.cursor++;
		const before = mockReact.effects[at];
		if (before?.deps.every((d, i) => Object.is(d, deps[i]))) return;
		mockReact.pending.push(() => {
			before?.cleanup?.();
			const cleanup = effect();
			mockReact.effects[at] = {
				deps,
				cleanup: typeof cleanup === "function" ? cleanup : undefined,
			};
		});
		mockReact.effects[at] ??= { deps };
	},
}));

import { useEnableLifecycle } from "./useEnableLifecycle";

function mount() {
	const render = (open: boolean, reset: () => void) => {
		mockReact.cursor = 0;
		mockReact.pending = [];
		const life = useEnableLifecycle({ open, reset });
		for (const run of mockReact.pending) run();
		return life;
	};
	const unmount = () => {
		for (const e of mockReact.effects) e?.cleanup?.();
	};
	mockReact.refs = [];
	mockReact.effects = [];
	return { render, unmount };
}

const draft = () => ({ keyText: "KEY", wipe: jest.fn() });

describe("useEnableLifecycle", () => {
	it("wipes and resets when open turns false, not while it stays true", async () => {
		const { render } = mount();
		const reset = jest.fn();
		const life = render(true, reset);
		const d = draft();
		await life.makeDraft(async () => d);
		render(true, reset);
		expect(d.wipe).not.toHaveBeenCalled();
		render(false, reset);
		expect(d.wipe).toHaveBeenCalledTimes(1);
		expect(reset).toHaveBeenCalledTimes(1);
		render(false, reset);
		expect(d.wipe).toHaveBeenCalledTimes(1);
		expect(reset).toHaveBeenCalledTimes(1);
	});

	it("wipes on unmount while open", async () => {
		const { render, unmount } = mount();
		const reset = jest.fn();
		const life = render(true, reset);
		const d = draft();
		await life.makeDraft(async () => d);
		expect(d.wipe).not.toHaveBeenCalled();
		unmount();
		expect(d.wipe).toHaveBeenCalledTimes(1);
		expect(reset).not.toHaveBeenCalled();
	});

	it("keeps one controller across renders and calls the newest reset", () => {
		const { render } = mount();
		const stale = jest.fn();
		const newest = jest.fn();
		const first = render(true, stale);
		expect(render(true, newest)).toBe(first);
		render(false, newest);
		expect(newest).toHaveBeenCalledTimes(1);
		expect(stale).not.toHaveBeenCalled();
	});

	it("a draft that finishes after the sheet unmounted wipes itself", async () => {
		const { render, unmount } = mount();
		const life = render(true, jest.fn());
		let finish: (d: ReturnType<typeof draft>) => void = () => {};
		const run = life.makeDraft(
			() => new Promise<ReturnType<typeof draft>>((r) => (finish = r)),
		);
		unmount();
		const late = draft();
		finish(late);
		expect((await run).status).toBe("late");
		expect(late.wipe).toHaveBeenCalledTimes(1);
	});
});
