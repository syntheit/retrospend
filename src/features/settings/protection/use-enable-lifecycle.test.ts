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
	const render = (open: boolean, reset: () => void) => {
		react.cursor = 0;
		react.pending = [];
		const life = useEnableLifecycle({ open, reset });
		for (const run of react.pending) run();
		return life;
	};
	const unmount = () => {
		for (const e of react.effects) e?.cleanup?.();
	};
	react.refs = [];
	react.effects = [];
	return { render, unmount };
}

const draft = () => ({ keyText: "KEY", wipe: vi.fn() });

describe("useEnableLifecycle", () => {
	it("wipes and resets when open turns false, not while it stays true", async () => {
		const { render } = mount();
		const reset = vi.fn();
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
		const reset = vi.fn();
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
		const stale = vi.fn();
		const newest = vi.fn();
		const first = render(true, stale);
		expect(render(true, newest)).toBe(first);
		render(false, newest);
		expect(newest).toHaveBeenCalledTimes(1);
		expect(stale).not.toHaveBeenCalled();
	});

	it("a draft that finishes after open turned false wipes itself", async () => {
		const { render } = mount();
		const life = render(true, vi.fn());
		let finish: (d: ReturnType<typeof draft>) => void = () => {};
		const run = life.makeDraft(
			() => new Promise<ReturnType<typeof draft>>((r) => (finish = r)),
		);
		render(false, vi.fn());
		const late = draft();
		finish(late);
		expect((await run).status).toBe("late");
		expect(late.wipe).toHaveBeenCalledTimes(1);
	});
});
