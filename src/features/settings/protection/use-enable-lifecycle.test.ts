// The hook's wiring, without a DOM: `useRef` and `useEffect` are replaced by a
// few lines that run effects the way React does (on mount, when a dependency
// changed, cleanup on unmount), so the calls from the effects into the
// controller are what is tested. The controller's own rules are in
// enable-lifecycle.test.ts.
import { describe, expect, it, vi } from "vitest";

const react = vi.hoisted(() => {
	type Slot = { current: unknown };
	const state = {
		cursor: 0,
		refs: [] as Slot[],
		effects: [] as { deps: unknown[]; cleanup?: () => void }[],
		pending: [] as (() => void)[],
	};
	return state;
});

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useRef: (initial: unknown) => {
		const at = react.cursor++;
		react.refs[at] ??= { current: initial };
		return react.refs[at];
	},
	useEffect: (effect: () => undefined | (() => void), deps: unknown[]) => {
		const at = react.cursor++;
		const before = react.effects[at];
		if (before?.deps.every((d, i) => Object.is(d, deps[i]))) return;
		react.pending.push(() => {
			before?.cleanup?.();
			const cleanup = effect();
			react.effects[at] = {
				deps,
				cleanup: typeof cleanup === "function" ? cleanup : undefined,
			};
		});
		react.effects[at] ??= { deps };
	},
}));

const { useEnableLifecycle } = await import("./use-enable-lifecycle");

function mount() {
	const calls = { discard: vi.fn(), reset: vi.fn() };
	const render = (open: boolean) => {
		react.cursor = 0;
		react.pending = [];
		const life = useEnableLifecycle({ open, ...calls });
		for (const run of react.pending) run();
		return life;
	};
	const unmount = () => {
		for (const e of react.effects) e?.cleanup?.();
	};
	react.refs = [];
	react.effects = [];
	return { calls, render, unmount };
}

describe("useEnableLifecycle", () => {
	it("wipes and resets when open turns false, not while it stays true", () => {
		const { calls, render } = mount();
		render(true);
		render(true);
		expect(calls.discard).not.toHaveBeenCalled();
		render(false);
		expect(calls.discard).toHaveBeenCalledTimes(1);
		expect(calls.reset).toHaveBeenCalledTimes(1);
		render(false);
		expect(calls.discard).toHaveBeenCalledTimes(1);
	});

	it("wipes on unmount while open", () => {
		const { calls, render, unmount } = mount();
		render(true);
		expect(calls.discard).not.toHaveBeenCalled();
		unmount();
		expect(calls.discard).toHaveBeenCalledTimes(1);
		expect(calls.reset).not.toHaveBeenCalled();
	});

	it("keeps one controller across renders and calls the newest callbacks", async () => {
		const { render } = mount();
		const first = render(true);
		expect(render(true)).toBe(first);
		const job = vi.fn(async () => "x");
		expect((await first.run(job)).status).toBe("done");
	});

	it("drops a job that finishes after open turned false", async () => {
		const { calls, render } = mount();
		const life = render(true);
		let finish: (v: string) => void = () => {};
		const run = life.run(() => new Promise<string>((r) => (finish = r)));
		render(false);
		finish("keys");
		expect(await run).toEqual({ status: "late" });
		expect(calls.discard).toHaveBeenCalledTimes(2);
	});
});
