import type { RetrospendClient } from "@retrospend/api-client";
import { cursor, template } from "@retrospend/engine/device-fake";
import { engineFor } from "@/data/device-engine";
import { deviceEngineModule } from "@/data/deviceEngineModule";
import { createOutbox, type Outbox } from "@/data/outbox";
import { createMemoryStore } from "@/data/store";
import { forgetNotFound, forgetUndoTokens } from "@/features/entry/send";
import { forgetSent } from "@/features/entry/sentRetain";
import { fakeDeviceApi } from "../../../test/deviceApi";
import {
	type PosterOutboxEntry,
	type PosterTaskDeps,
	posterOutboxEntry,
	readServerAuto,
	readProtected,
	runPoster,
	runPosterTask,
} from "./poster";

// The phone's recurring poster over a real device engine (fake server), an
// in-memory outbox and a recording v1 client. Home is ARS in Buenos Aires
// (UTC-3), blue rates, a monthly USD 20 template due at the start of a day
// there (03:00Z). By hand, with blue 1,500 on Sep 1, 1,520 on Oct 1 and 1,545
// on Nov 1 and Dec 1: a period books USD 20 x that day's rate, so ARS
// 30,000.00, 30,400.00, 30,900.00 and 30,900.00.

// Client ids in order, so a chain reads c0, c1, c2.
jest.mock("@/data/ids", () => {
	let n = 0;
	return { newClientId: () => `c${n++}` };
});

const STAMP = "2026-11-18T10:00:00.000Z";
const rateRow = (id: string, day: string, unitsPerUsd: string) => ({
	id,
	currency: "ARS",
	type: "blue",
	date: `${day}T00:00:00.000Z`,
	unitsPerUsd,
});
const RATES = {
	asOf: "2026-12-01T00:00:00.000Z",
	rates: [
		rateRow("r1", "2026-09-01", "1500"),
		rateRow("r2", "2026-10-01", "1520"),
		rateRow("r3", "2026-11-01", "1545"),
		rateRow("r4", "2026-12-01", "1545"),
	],
};
const page = (items: unknown[]) => ({
	items,
	tombstones: [],
	cursor: cursor("100"),
	hasMore: false,
});
const problem = (status: number, code: string) =>
	Object.assign(new Error(code), { status, code });

const ACKS = [
	"2026-12-01T03:06:01.000Z",
	"2026-12-01T03:06:02.000Z",
	"2026-12-01T03:06:03.000Z",
];

interface Options {
	templates?: ReturnType<typeof template>[];
	autoPost?: boolean;
	/** features.autoConfirm; absent from a server before contract 1.13.0. */
	autoConfirm?: boolean | null;
	keys?: "none" | "keyed" | "down";
	now?: string;
	confirm?: (n: number) => unknown;
}

async function setup(options: Options = {}) {
	process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE = "1";
	jest.useFakeTimers({
		now: new Date(options.now ?? "2026-12-01T03:05:00.000Z"),
	});
	const fake = fakeDeviceApi({
		rates: RATES,
		expenses: [page([])],
		transfers: [page([])],
		templates: [page(options.templates ?? [template("t1")])],
	});
	let n = 0;
	const confirm = jest.fn(async (_input: unknown, _options: unknown) => {
		const answer = options.confirm?.(n);
		n += 1;
		if (answer instanceof Error) throw answer;
		return {
			undo: `tok-${n}`,
			confirmed: { templateUpdatedAt: ACKS[n - 1] ?? ACKS[2] },
		};
	});
	const keys = jest.fn(async () => {
		if (options.keys === "keyed") return {};
		throw options.keys === "down"
			? new Error("Network request failed")
			: problem(404, "not_found");
	});
	const serverInfo = jest.fn(async () => ({
		features: {
			autoPost: options.autoPost ?? true,
			...(options.autoConfirm === null
				? {}
				: { autoConfirm: options.autoConfirm ?? true }),
		},
	}));
	const client = Object.assign(fake.client, {
		recurring: { confirm },
		protection: { keys },
		platform: { serverInfo },
	}) as RetrospendClient;
	const outbox = createOutbox(createMemoryStore(), "scope");
	const engine = engineFor(client, "u1", null, undefined, outbox);
	await engine.pull();
	return { client, outbox, engine, confirm, keys, serverInfo, fake };
}

const open = (outbox: Outbox) => outbox.all();

beforeEach(() => {
	forgetUndoTokens();
	forgetSent();
	for (let i = 0; i < 6; i += 1) forgetNotFound(`c${i}`);
});
afterEach(() => {
	delete process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE;
	jest.useRealTimers();
});

describe("a poster run", () => {
	it("posts a due auto-pay period as one confirm carrying the template stamp, the due date and the device booking", async () => {
		const { client, outbox, confirm } = await setup();
		const out = await runPoster({ api: client, outbox });
		expect(out).toEqual({ status: "ran", queued: 1, stoppedByPull: false });
		expect(confirm).toHaveBeenCalledTimes(1);
		const [sent] = confirm.mock.calls[0] ?? [];
		expect(sent).toMatchObject({
			id: "t1",
			dueAt: "2026-12-01T03:00:00.000Z",
			expectedUpdatedAt: STAMP,
			auto: true,
		});
		// Sent and acked: the acked list keeps the device's booking until a pull.
		const { open: left, acked } = await outbox.snapshot();
		expect(left).toEqual([]);
		expect(acked).toHaveLength(1);
		expect(acked[0]).toMatchObject({
			origin: "poster",
			kind: "confirm",
			targetId: "t1",
			baseVersion: STAMP,
		});
		const expense = acked[0]?.device?.changes.find(
			(c) => c.table === "expenses",
		);
		const after = expense?.after as { homeAmount: unknown } | undefined;
		expect(String(after?.homeAmount)).toBe("30900.00");
	});

	it("queues one chained confirm per missed period, each at its own day's rate", async () => {
		const { client, outbox, confirm } = await setup({
			now: "2026-11-01T03:05:00.000Z",
			templates: [template("t1", { nextDueDate: "2026-09-01T03:00:00.000Z" })],
			// No network: the entries stay queued, so the chain is visible.
			confirm: () => new Error("Network request failed"),
		});
		await runPoster({ api: client, outbox });
		expect(confirm).toHaveBeenCalledTimes(1);
		const entries = await open(outbox);
		expect(entries.map((e) => e.baseVersion)).toEqual([
			STAMP,
			{ after: entries[0]?.clientId },
			{ after: entries[1]?.clientId },
		]);
		expect(entries.map((e) => (e.payload as { dueAt: string }).dueAt)).toEqual([
			"2026-09-01T03:00:00.000Z",
			"2026-10-01T03:00:00.000Z",
			"2026-11-01T03:00:00.000Z",
		]);
		expect(entries.every((e) => e.origin === "poster")).toBe(true);
		const booked = entries.map(
			(e) =>
				e.device?.changes.find((c) => c.table === "expenses")?.after as {
					homeAmount: string;
				},
		);
		expect(booked.map((b) => String(b.homeAmount))).toEqual([
			"30000.00",
			"30400.00",
			"30900.00",
		]);
	});

	it("sends the periods in order, each carrying the earlier ack's template version", async () => {
		const { client, outbox, confirm } = await setup({
			now: "2026-11-01T03:05:00.000Z",
			templates: [template("t1", { nextDueDate: "2026-09-01T03:00:00.000Z" })],
		});
		await runPoster({ api: client, outbox });
		const stamps = confirm.mock.calls.map(
			([sent]) => (sent as { expectedUpdatedAt: string }).expectedUpdatedAt,
		);
		expect(stamps).toEqual([STAMP, ACKS[0], ACKS[1]]);
	});

	it("leaves a template alone while it has an entry the phone has not seen back", async () => {
		const { client, outbox, engine, confirm } = await setup();
		await runPoster({ api: client, outbox });
		// Acked, no pull yet: the store still shows the old due date.
		const plan = jest.spyOn(engine, "planPoster");
		const again = await runPoster({ api: client, outbox });
		expect(again).toEqual({ status: "ran", queued: 0, stoppedByPull: false });
		expect(confirm).toHaveBeenCalledTimes(1);
		// Left out of the plan itself, not only refused when booked over the overlay.
		expect(plan.mock.calls[0]?.[0].skip).toEqual(new Set(["t1"]));
	});

	it("leaves a template alone while its entry is unsent", async () => {
		const { client, outbox, engine, confirm } = await setup({
			confirm: () => new Error("Network request failed"),
		});
		await runPoster({ api: client, outbox });
		const plan = jest.spyOn(engine, "planPoster");
		await runPoster({ api: client, outbox });
		expect(await open(outbox)).toHaveLength(1);
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(plan.mock.calls[0]?.[0].skip).toEqual(new Set(["t1"]));
	});

	it("retires an entry the server says changed, with no Sync issue, and drops the rest of its run", async () => {
		const { client, outbox, confirm } = await setup({
			now: "2026-11-01T03:05:00.000Z",
			templates: [template("t1", { nextDueDate: "2026-09-01T03:00:00.000Z" })],
			confirm: () => problem(409, "recurring_changed"),
		});
		await runPoster({ api: client, outbox });
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(await outbox.snapshot()).toEqual({ open: [], acked: [] });
	});
});

describe("protection turned on mid-run", () => {
	it("stops the run at the refused entry, keeps it, and goes on to no other template", async () => {
		const { client, outbox, confirm } = await setup({
			templates: [template("t1"), template("t2", { name: "Gym" })],
			confirm: () => problem(403, "protected_account"),
		});
		await runPoster({ api: client, outbox });
		expect(confirm).toHaveBeenCalledTimes(1);
		const entries = await open(outbox);
		expect(entries.map((e) => [e.targetId, e.state])).toEqual([
			["t1", "failed"],
			["t2", "pending"],
		]);
		expect(entries.every((e) => e.origin === "poster")).toBe(true);
	});
});

describe("what stops the poster", () => {
	it("plans nothing when the server's auto-post is off", async () => {
		const { client, outbox, confirm } = await setup({ autoPost: false });
		expect(await runPoster({ api: client, outbox })).toEqual({
			status: "auto_post_off",
		});
		expect(await outbox.snapshot()).toEqual({ open: [], acked: [] });
		expect(confirm).not.toHaveBeenCalled();
	});

	it("plans nothing when the server does not say, or cannot be asked", async () => {
		const { client, serverInfo } = await setup();
		serverInfo.mockResolvedValueOnce({ features: {} } as never);
		const off = { autoPost: false, income: false };
		expect(await readServerAuto(client)).toEqual(off);
		serverInfo.mockRejectedValueOnce(new Error("Network request failed"));
		expect(await readServerAuto(client)).toEqual(off);
	});

	it("the engine itself plans nothing for auto-post off", async () => {
		const { engine } = await setup();
		const none = await engine.planPoster({
			autoPost: false,
			income: true,
			isProtected: async () => false,
			skip: new Set(),
		});
		expect(none).toEqual([]);
		const some = await engine.planPoster({
			autoPost: true,
			income: true,
			isProtected: async () => false,
			skip: new Set(),
		});
		expect(some).toHaveLength(1);
	});

	it("plans nothing for an account with protection keys, or one it cannot read", async () => {
		for (const keys of ["keyed", "down"] as const) {
			const { client, outbox, confirm } = await setup({ keys });
			expect(await runPoster({ api: client, outbox })).toEqual({
				status: "protected",
			});
			expect(await outbox.snapshot()).toEqual({ open: [], acked: [] });
			expect(confirm).not.toHaveBeenCalled();
		}
	});

	it("reads only a 404 on the keys as unprotected", async () => {
		const { client, keys } = await setup();
		expect(await readProtected(client)).toBe(false);
		keys.mockRejectedValueOnce(problem(500, "server_error"));
		expect(await readProtected(client)).toBe(true);
		keys.mockResolvedValueOnce({} as never);
		expect(await readProtected(client)).toBe(true);
	});

	it("posts an income template as an auto confirm with the stamp, booked row only on the device", async () => {
		const { client, outbox, confirm } = await setup({
			templates: [template("t1", { direction: "IN" })],
		});
		expect(await runPoster({ api: client, outbox })).toEqual({
			status: "ran",
			queued: 1,
			stoppedByPull: false,
		});
		expect(confirm.mock.calls[0]?.[0]).toEqual({
			id: "t1",
			dueAt: "2026-12-01T03:00:00.000Z",
			expenseId: expect.stringMatching(/^c\d+$/),
			expectedUpdatedAt: STAMP,
			auto: true,
		});
		const { acked } = await outbox.snapshot();
		const changes = acked[0]?.device?.changes ?? [];
		expect(changes.map((c) => c.table)).toEqual([
			"expenses",
			"recurringTemplates",
		]);
		const row = changes[0]?.after as { direction: string } | undefined;
		expect(row?.direction).toBe("IN");
	});

	it("a server that does not say it takes auto (before 1.13.0) gets no income entry: the expense template posts, the income one is left alone", async () => {
		const { client, outbox, confirm } = await setup({
			autoConfirm: null,
			templates: [
				template("t1"),
				template("t2", { name: "Salary", direction: "IN" }),
			],
		});
		expect(await runPoster({ api: client, outbox })).toMatchObject({
			status: "ran",
			queued: 1,
		});
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(confirm.mock.calls[0]?.[0]).toMatchObject({ id: "t1" });
		// Asked to say it does not take auto, it is the same.
		const off = await setup({
			autoConfirm: false,
			templates: [template("t2", { direction: "IN" })],
		});
		expect(await runPoster({ api: off.client, outbox: off.outbox })).toMatchObject({
			queued: 0,
		});
	});

	it("a person's income confirm, without auto, is never booked by the device", async () => {
		const { engine } = await setup({
			templates: [template("t1", { direction: "IN" })],
		});
		expect(
			await engine.book({
				kind: "confirm",
				body: {
					templateId: "t1",
					dueAt: "2026-12-01T03:00:00.000Z",
					expenseId: "p1",
				},
			}),
		).toBeNull();
	});

	it("plans nothing for a template that is paused, not due, or asks for an amount", async () => {
		const { client, outbox, confirm } = await setup({
			templates: [
				template("t1", { isActive: false }),
				template("t2", { nextDueDate: "2026-12-02T03:00:00.000Z" }),
				template("t3", { amountMode: "ASK" }),
				template("t4", { autoPay: false }),
			],
		});
		expect(await runPoster({ api: client, outbox })).toMatchObject({
			queued: 0,
		});
		expect(confirm).not.toHaveBeenCalled();
	});

	it("does nothing without the flag: no engine module, no question to the server", async () => {
		const { client, outbox, serverInfo } = await setup();
		delete process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE;
		expect(await runPoster({ api: client, outbox })).toEqual({ status: "off" });
		expect(serverInfo).not.toHaveBeenCalled();
		expect(deviceEngineModule()).toBeNull();
	});

	it("does nothing for a client with no engine", async () => {
		process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE = "1";
		const { client } = fakeDeviceApi();
		const outbox = createOutbox(createMemoryStore(), "scope");
		expect(await runPoster({ api: client, outbox })).toEqual({ status: "off" });
	});
});

describe("exclusive with pulls", () => {
	it("plans nothing while a pull is running", async () => {
		const { client, outbox, engine, confirm, fake } = await setup();
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const route = client.sync as unknown as Record<
			string,
			(query: unknown) => Promise<unknown>
		>;
		const original = route.recurringTemplates;
		route.recurringTemplates = async (query) => {
			await gate;
			return original?.(query);
		};
		const pulling = engine.pull();
		await Promise.resolve();
		expect(await runPoster({ api: client, outbox })).toEqual({
			status: "not_ready",
		});
		expect(await outbox.snapshot()).toEqual({ open: [], acked: [] });
		release();
		await pulling;
		expect(confirm).not.toHaveBeenCalled();
		expect(fake.pulls()).toBe(2);
	});

	it("stops at the first period after a pull begins, leaving the rest to the next run", async () => {
		const { client, outbox, engine } = await setup({
			now: "2026-11-01T03:05:00.000Z",
			templates: [template("t1", { nextDueDate: "2026-09-01T03:00:00.000Z" })],
			confirm: () => new Error("Network request failed"),
		});
		const enqueue = outbox.enqueue.bind(outbox);
		let first = true;
		const watched: Outbox = {
			...outbox,
			enqueue: async (entry) => {
				const queued = await enqueue(entry);
				if (first) {
					first = false;
					await engine.pull();
				}
				return queued;
			},
		};
		const out = await runPoster({ api: client, outbox: watched });
		expect(out).toEqual({ status: "ran", queued: 1, stoppedByPull: true });
		expect(await open(outbox)).toHaveLength(1);
	});
});

describe("a poster entry always has a stamp", () => {
	const plan = { title: "Rent", currency: "USD" };
	const entry = (stamp: unknown) =>
		({
			origin: "poster",
			templateId: "t1",
			index: 1,
			dueAt: new Date("2026-12-01T03:00:00.000Z"),
			plan: {},
			expectedStamp: stamp,
		}) as never;

	it("cannot be typed without one", () => {
		const ok: PosterOutboxEntry = posterOutboxEntry(
			entry({ version: STAMP }),
			plan,
			["a", "b"],
		);
		// @ts-expect-error a poster entry has no null base
		const bad: PosterOutboxEntry = { ...ok, baseVersion: null };
		expect(bad.baseVersion).toBeNull();
	});

	it("is refused when the stamp names nothing", () => {
		expect(() =>
			posterOutboxEntry(entry({ after: 5 }), plan, ["a", "b"]),
		).toThrow("not there");
		expect(() => posterOutboxEntry(entry({ after: 0 }), plan, ["a"])).toThrow(
			"client id",
		);
	});

	it("is refused by the outbox with a null base", async () => {
		const outbox = createOutbox(createMemoryStore(), "scope");
		const ok = posterOutboxEntry(entry({ version: STAMP }), plan, ["a", "b"]);
		await expect(
			outbox.enqueue({ ...ok, baseVersion: null } as never),
		).rejects.toThrow("version or a chain");
		await expect(outbox.enqueue(ok)).resolves.toMatchObject({
			origin: "poster",
			baseVersion: STAMP,
		});
	});
});

describe("the background run", () => {
	const who = { baseUrl: "https://s", meId: "me" };
	const deps = (over: Partial<PosterTaskDeps> = {}) => {
		const run = jest.fn(async () => ({ status: "off" }) as const);
		const forget = jest.fn(async () => undefined);
		return {
			run,
			forget,
			deps: {
				who: async () => who,
				signedInAs: async () => "me",
				forget,
				appActive: () => false,
				run,
				...over,
			} satisfies PosterTaskDeps,
		};
	};

	it("runs for the account that armed it", async () => {
		const { deps: d, run } = deps();
		await runPosterTask(d);
		expect(run).toHaveBeenCalledWith(who);
	});

	it("does nothing for nobody", async () => {
		const { deps: d, run } = deps({ who: async () => null });
		expect(await runPosterTask(d)).toEqual({
			status: "skipped",
			why: "nobody",
		});
		expect(run).not.toHaveBeenCalled();
	});

	it("forgets an account that is no longer signed in, and never posts for the next one", async () => {
		const {
			deps: d,
			run,
			forget,
		} = deps({ signedInAs: async () => "someone" });
		expect(await runPosterTask(d)).toEqual({
			status: "skipped",
			why: "other_account",
		});
		expect(forget).toHaveBeenCalledWith(who);
		expect(run).not.toHaveBeenCalled();
	});

	it("leaves the run to the app while it is on screen", async () => {
		const { deps: d, run } = deps({ appActive: () => true });
		expect(await runPosterTask(d)).toEqual({
			status: "skipped",
			why: "app_open",
		});
		expect(run).not.toHaveBeenCalled();
	});
});
