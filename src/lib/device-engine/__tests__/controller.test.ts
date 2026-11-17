import { describe, expect, it, vi } from "vitest";
import {
	BACKOFF_MAX_MS,
	BACKOFF_MS,
	createDeviceController,
} from "../controller";
import { DeviceError, type DeviceErrorCode } from "../protocol";
import type { DeviceClient } from "../rpc";

type Pull = DeviceClient["pull"];

function fakeClient(pull?: Pull) {
	const client = {
		dead: false,
		start: vi.fn(async () => undefined),
		pull: vi.fn<Pull>(
			pull ?? (async () => ({ status: "ready", generation: 1 })),
		),
		read: vi.fn(),
		verify: vi.fn(),
		stop: vi.fn(async () => undefined),
		terminate: vi.fn(() => {
			client.dead = true;
		}),
	};
	return client;
}

function setup(clients: ReturnType<typeof fakeClient>[] = [fakeClient()]) {
	const queue = [...clients];
	const time = { now: 1_000_000, visible: true };
	const load = vi.fn(
		async () => (queue.shift() ?? null) as DeviceClient | null,
	);
	const controller = createDeviceController({
		load,
		now: () => time.now,
		visible: () => time.visible,
	});
	return { controller, load, time };
}

const ANA = { id: "u1", protectedAccount: false };
const refuse =
	(code: DeviceErrorCode): Pull =>
	async () => {
		throw new DeviceError(code);
	};

describe("device controller: who starts", () => {
	it("starts nothing without a signed-in account", async () => {
		const { controller, load } = setup();
		await controller.homeOpened();
		expect(load).not.toHaveBeenCalled();
		expect(controller.state).toBe("off");
	});

	it("starts nothing for a protected account", async () => {
		const { controller, load } = setup();
		controller.setUser({ id: "u1", protectedAccount: true });
		await controller.homeOpened();
		await controller.tabVisible();
		expect(load).not.toHaveBeenCalled();
		expect(controller.state).toBe("terminal");
	});

	it("starts the worker for the account when Home opens, then pulls", async () => {
		const client = fakeClient();
		const { controller, load } = setup([client]);
		controller.setUser(ANA);
		await controller.homeOpened();
		expect(load).toHaveBeenCalledTimes(1);
		expect(client.start).toHaveBeenCalledWith("u1");
		expect(client.pull).toHaveBeenCalledTimes(1);
		expect(controller.state).toBe("running");
		expect(controller.client).toBe(client);
	});

	it("pulls once the account is known when Home opened first (layout effects run last)", async () => {
		const client = fakeClient();
		const { controller } = setup([client]);
		await controller.homeOpened();
		expect(client.pull).not.toHaveBeenCalled();
		controller.setUser(ANA);
		await vi.waitFor(() => expect(client.pull).toHaveBeenCalledTimes(1));
	});

	it("with the flag off (no worker) stays idle and never retries a load", async () => {
		const { controller, load } = setup([]);
		controller.setUser(ANA);
		await controller.homeOpened();
		expect(controller.client).toBeNull();
		expect(load).toHaveBeenCalledTimes(1);
	});
});

describe("device controller: terminal refusals", () => {
	it.each(["protected_account", "unauthenticated", "forbidden"] as const)(
		"%s ends the worker and nothing retries",
		async (code) => {
			const client = fakeClient(refuse(code));
			const { controller, load, time } = setup([client, fakeClient()]);
			controller.setUser(ANA);
			await controller.homeOpened();
			expect(controller.state).toBe("terminal");
			expect(client.terminate).toHaveBeenCalled();
			// A day later, Home again, the tab back in front: still nothing.
			time.now += 86_400_000;
			await controller.homeOpened();
			await controller.tabVisible();
			expect(load).toHaveBeenCalledTimes(1);
			expect(client.pull).toHaveBeenCalledTimes(1);
		},
	);

	it("a new account after a terminal one starts fresh", async () => {
		const second = fakeClient();
		const { controller } = setup([
			fakeClient(refuse("protected_account")),
			second,
		]);
		controller.setUser(ANA);
		await controller.homeOpened();
		controller.setUser({ id: "u2", protectedAccount: false });
		await controller.homeOpened();
		expect(second.start).toHaveBeenCalledWith("u2");
		expect(controller.state).toBe("running");
	});
});

describe("device controller: end of the session", () => {
	it("sign-out stops and terminates the worker", async () => {
		const client = fakeClient();
		const { controller } = setup([client]);
		controller.setUser(ANA);
		await controller.homeOpened();
		controller.setUser(null);
		expect(client.stop).toHaveBeenCalled();
		expect(client.terminate).toHaveBeenCalled();
		expect(controller.state).toBe("off");
		expect(controller.client).toBeNull();
	});

	it("another account ends the old worker and starts one for the new", async () => {
		const first = fakeClient();
		const second = fakeClient();
		const { controller } = setup([first, second]);
		controller.setUser(ANA);
		await controller.homeOpened();
		controller.setUser({ id: "u2", protectedAccount: false });
		expect(first.terminate).toHaveBeenCalled();
		await controller.homeOpened();
		expect(second.start).toHaveBeenCalledWith("u2");
		expect(controller.client).toBe(second);
	});

	it("drops a worker that finished starting for an account that has gone", async () => {
		const stale = fakeClient();
		let release: () => void = () => undefined;
		stale.start.mockImplementation(
			() =>
				new Promise<undefined>(
					(resolve) => (release = () => resolve(undefined)),
				),
		);
		const { controller } = setup([stale]);
		controller.setUser(ANA);
		const opening = controller.homeOpened();
		await vi.waitFor(() => expect(stale.start).toHaveBeenCalled());
		controller.setUser(null);
		release();
		await opening;
		expect(stale.terminate).toHaveBeenCalled();
		expect(stale.pull).not.toHaveBeenCalled();
		expect(controller.client).toBeNull();
	});

	it("ignores the answer of a pull for an account that has gone", async () => {
		let refuseLate: () => void = () => undefined;
		const old = fakeClient(
			() =>
				new Promise(
					(_, reject) =>
						(refuseLate = () => reject(new DeviceError("protected_account"))),
				),
		);
		const next = fakeClient();
		const { controller } = setup([old, next]);
		controller.setUser(ANA);
		const first = controller.homeOpened();
		await vi.waitFor(() => expect(old.pull).toHaveBeenCalled());
		controller.setUser({ id: "u2", protectedAccount: false });
		refuseLate();
		await first;
		// u2 (started because Home is open) is not marked terminal by u1's refusal.
		await vi.waitFor(() => expect(next.start).toHaveBeenCalledWith("u2"));
		expect(controller.state).toBe("running");
		expect(next.terminate).not.toHaveBeenCalled();
	});
});

describe("device controller: when it pulls", () => {
	it("pulls on a tab coming to the front only when Home started a worker", async () => {
		const client = fakeClient();
		const { controller, load } = setup([client]);
		controller.setUser(ANA);
		await controller.tabVisible();
		expect(load).not.toHaveBeenCalled();
		await controller.homeOpened();
		await controller.tabVisible();
		expect(client.pull).toHaveBeenCalledTimes(2);
	});

	it("never pulls in a hidden tab", async () => {
		const client = fakeClient();
		const { controller, time } = setup([client]);
		controller.setUser(ANA);
		time.visible = false;
		await controller.homeOpened();
		await controller.tabVisible();
		expect(client.pull).not.toHaveBeenCalled();
		time.visible = true;
		await controller.tabVisible();
		expect(client.pull).not.toHaveBeenCalled();
		await controller.homeOpened();
		expect(client.pull).toHaveBeenCalledTimes(1);
	});

	it("shares one pull between overlapping triggers", async () => {
		let finish: () => void = () => undefined;
		const client = fakeClient(
			() =>
				new Promise(
					(resolve) =>
						(finish = () => resolve({ status: "ready", generation: 1 })),
				),
		);
		const { controller } = setup([client]);
		controller.setUser(ANA);
		const a = controller.homeOpened();
		await vi.waitFor(() => expect(client.pull).toHaveBeenCalled());
		const b = controller.tabVisible();
		finish();
		await Promise.all([a, b]);
		expect(client.pull).toHaveBeenCalledTimes(1);
	});
});

describe("device controller: backing off", () => {
	it("a 429 leaves the screen alone and waits, doubling up to a cap", async () => {
		const client = fakeClient(refuse("rate_limited"));
		const { controller, time } = setup([client]);
		controller.setUser(ANA);
		await controller.homeOpened();
		expect(controller.state).toBe("running");
		await controller.tabVisible();
		expect(client.pull).toHaveBeenCalledTimes(1);

		time.now += BACKOFF_MS - 1;
		await controller.tabVisible();
		expect(client.pull).toHaveBeenCalledTimes(1);

		time.now += 1;
		await controller.tabVisible();
		expect(client.pull).toHaveBeenCalledTimes(2);

		// The second limit waits twice as long.
		time.now += 2 * BACKOFF_MS - 1;
		await controller.tabVisible();
		expect(client.pull).toHaveBeenCalledTimes(2);
		time.now += 1;
		await controller.tabVisible();
		expect(client.pull).toHaveBeenCalledTimes(3);

		for (let i = 0; i < 6; i++) {
			time.now += BACKOFF_MAX_MS;
			await controller.tabVisible();
		}
		const calls = client.pull.mock.calls.length;
		time.now += BACKOFF_MAX_MS - 1;
		await controller.tabVisible();
		expect(client.pull).toHaveBeenCalledTimes(calls);
	});

	it("a pull that failed without a code waits a minute", async () => {
		const client = fakeClient(async () => ({
			status: "failed",
			generation: 0,
		}));
		const { controller, time } = setup([client]);
		controller.setUser(ANA);
		await controller.homeOpened();
		time.now += BACKOFF_MS - 1;
		await controller.homeOpened();
		expect(client.pull).toHaveBeenCalledTimes(1);
		time.now += 1;
		await controller.homeOpened();
		expect(client.pull).toHaveBeenCalledTimes(2);
	});

	it("starts a new worker after a dead one, once the wait is over", async () => {
		const dead = fakeClient(refuse("worker_dead"));
		const next = fakeClient();
		const { controller, time, load } = setup([dead, next]);
		controller.setUser(ANA);
		await controller.homeOpened();
		expect(controller.client).toBeNull();
		await controller.homeOpened();
		expect(load).toHaveBeenCalledTimes(1);
		time.now += BACKOFF_MS;
		await controller.homeOpened();
		expect(next.pull).toHaveBeenCalledTimes(1);
	});
});
