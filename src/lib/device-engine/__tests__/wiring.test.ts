import { describe, expect, it, vi } from "vitest";
import type { DeviceController } from "../controller";
import { bindTab, deviceUser, type TabDocument } from "../wiring";

// react.tsx only passes the session and `document` to these, so the layout's
// behavior is tested here without a DOM.
function fakeDocument() {
	const listeners = new Set<() => void>();
	const doc: TabDocument & { fire(): void } = {
		visibilityState: "visible",
		addEventListener: (_type, l) => void listeners.add(l),
		removeEventListener: (_type, l) => void listeners.delete(l),
		fire: () => {
			for (const l of [...listeners]) l();
		},
	};
	return { doc, listeners };
}
const fakeController = () =>
	({
		tabVisible: vi.fn(async () => undefined),
		setUser: vi.fn(),
	}) as unknown as DeviceController & {
		tabVisible: ReturnType<typeof vi.fn>;
		setUser: ReturnType<typeof vi.fn>;
	};

describe("deviceUser", () => {
	it("is null when signed out", () => {
		expect(deviceUser(null)).toBeNull();
		expect(deviceUser(undefined)).toBeNull();
	});

	it("marks a protected account from the session's protection state", () => {
		expect(
			deviceUser({ id: "u1", protectionState: "ON" } as { id: string }),
		).toEqual({
			id: "u1",
			protectedAccount: true,
		});
		expect(
			deviceUser({ id: "u1", protectionState: "OFF" } as { id: string }),
		).toEqual({
			id: "u1",
			protectedAccount: false,
		});
		expect(deviceUser({ id: "u1" })).toEqual({
			id: "u1",
			protectedAccount: false,
		});
	});
});

describe("bindTab", () => {
	it("pulls when the tab becomes visible, never when it hides", () => {
		const { doc } = fakeDocument();
		const controller = fakeController();
		bindTab(controller, doc);
		doc.visibilityState = "hidden";
		doc.fire();
		expect(controller.tabVisible).not.toHaveBeenCalled();
		doc.visibilityState = "visible";
		doc.fire();
		expect(controller.tabVisible).toHaveBeenCalledTimes(1);
	});

	it("on unmount removes the listener and signs out, which ends the worker", () => {
		const { doc, listeners } = fakeDocument();
		const controller = fakeController();
		const unbind = bindTab(controller, doc);
		expect(listeners.size).toBe(1);
		unbind();
		expect(listeners.size).toBe(0);
		expect(controller.setUser).toHaveBeenCalledWith(null);
		doc.fire();
		expect(controller.tabVisible).not.toHaveBeenCalled();
	});
});
