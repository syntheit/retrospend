import type { TemplateSeen } from "@retrospend/engine/device";
import type { DeviceWrites } from "@/data/device-engine";
import { createOutbox, type Outbox } from "@/data/outbox";
import { confirm } from "@/data/outboxFixtures";
import { createMemoryStore } from "@/data/store";
import { commitRebase, planRebase } from "./rebase";
import { RECURRING_CHANGED } from "./send";

// Try again on a parked recurring confirm or skip saves it again over the
// template a pull brought, as a new write under a new key, but only while the
// period it names is still the template's next one. Template t1 is due
// 2026-12-01T03:00Z; the pull brought version V2.

let mockNextId = 0;
jest.mock("@/data/ids", () => ({ newClientId: () => `new-${++mockNextId}` }));

const STAMP = "2026-11-18T10:00:00.000Z";
const V2 = "2026-11-25T08:00:00.000Z";
const DUE = "2026-12-01T03:00:00.000Z";

const seen = (over: Partial<Extract<TemplateSeen, { found: true }>> = {}) =>
	({
		found: true,
		paused: false,
		passed: false,
		posted: false,
		version: V2,
		currency: "USD",
		amountMode: "ASK",
		...over,
	}) as TemplateSeen;

function setup(template: TemplateSeen | null = seen()) {
	const writes = {
		templateSince: jest.fn(async () => template),
		book: jest.fn(async () => ({
			bookedAt: 1,
			changes: [],
			changed: [],
			base: V2,
		})),
		refresh: jest.fn(async () => undefined),
	} as unknown as jest.Mocked<DeviceWrites>;
	const outbox: Outbox = createOutbox(createMemoryStore(), "scope");
	return { writes, outbox };
}

async function park(
	outbox: Outbox,
	over: Parameters<typeof confirm>[3] = {},
	kind: "confirm" | "skip" = "confirm",
) {
	await outbox.enqueue({
		...confirm("c1", "t1", STAMP, {
			payload: {
				dueAt: DUE,
				amount: "18.50",
				paidOn: "2026-12-02",
				title: "Netflix",
				currency: "USD",
			},
			...over,
		}),
		kind,
	});
	await outbox.markConflict("c1", RECURRING_CHANGED);
}

beforeEach(() => {
	mockNextId = 0;
});

describe("planRebase of a recurring entry", () => {
	it("is the same confirm over the pulled version, read after any finished pull", async () => {
		const { writes, outbox } = setup();
		await park(outbox);
		const plan = await planRebase({ outbox, writes, clientId: "c1" });
		expect(plan).toMatchObject({
			version: V2,
			op: {
				kind: "confirm",
				body: {
					templateId: "t1",
					dueAt: DUE,
					amount: "18.50",
					paidOn: "2026-12-02",
				},
			},
		});
		// The entry names the template, the due date, and the expense it booked.
		expect(writes.templateSince).toHaveBeenCalledWith(
			"t1",
			0,
			new Date(DUE),
			"c1",
		);
	});

	it("is a skip for a skip, with no amount or day", async () => {
		const { writes, outbox } = setup();
		await park(outbox, { payload: { dueAt: DUE, title: "Netflix" } }, "skip");
		const plan = await planRebase({ outbox, writes, clientId: "c1" });
		expect(plan?.op).toEqual({
			kind: "skip",
			body: { templateId: "t1", dueAt: DUE },
		});
	});

	it.each([
		["a template a pull has not shown yet", null],
		["a template that is gone", { found: false } as TemplateSeen],
		["a paused template", seen({ paused: true })],
		["a period the template moved past", seen({ passed: true })],
		[
			"a template the device made and the server has not named",
			seen({ version: null }),
		],
		[
			"a typed USD amount on a template that is ARS now",
			seen({ currency: "ARS" }),
		],
		[
			"a typed amount on a template that no longer asks for one",
			seen({ amountMode: "FIXED" }),
		],
	])("is null, Discard only, for %s", async (_name, template) => {
		const { writes, outbox } = setup(template);
		await park(outbox);
		expect(await planRebase({ outbox, writes, clientId: "c1" })).toBeNull();
	});

	it("keeps an amount typed for ARS while the template is still ARS, and needs none for a skip", async () => {
		const ars = setup(seen({ currency: "ARS" }));
		await park(ars.outbox, {
			payload: { dueAt: DUE, amount: "15000", currency: "ARS", title: "Rent" },
		});
		expect(
			await planRebase({
				outbox: ars.outbox,
				writes: ars.writes,
				clientId: "c1",
			}),
		).toMatchObject({ op: { kind: "confirm", body: { amount: "15000" } } });
		// A skip types no amount: a currency change does not stop it.
		const skip = setup(seen({ currency: "EUR", amountMode: "FIXED" }));
		await park(skip.outbox, { payload: { dueAt: DUE, title: "Rent" } }, "skip");
		expect(
			await planRebase({
				outbox: skip.outbox,
				writes: skip.writes,
				clientId: "c1",
			}),
		).not.toBeNull();
	});

	it("is null for an entry that is not parked, and for one with no due date", async () => {
		const { writes, outbox } = setup();
		await outbox.enqueue(confirm("c1", "t1", STAMP));
		expect(await planRebase({ outbox, writes, clientId: "c1" })).toBeNull();
		await outbox.markConflict("c1", RECURRING_CHANGED);
		await outbox.discard("c1");
		await park(outbox, { payload: { title: "no due date" } });
		expect(await planRebase({ outbox, writes, clientId: "c1" })).toBeNull();
	});
});

describe("commitRebase of a recurring entry", () => {
	it("swaps it for a new write: a new id (the new expense's too), the pulled version as its stamp, and a booking under that id", async () => {
		const { writes, outbox } = setup();
		await park(outbox);
		const plan = await planRebase({ outbox, writes, clientId: "c1" });
		const next = await commitRebase({
			outbox,
			writes,
			clientId: "c1",
			plan: plan as NonNullable<typeof plan>,
		});
		expect(next).toBe("new-1");
		// A confirm books its expense under the new entry's id, not the old one's.
		expect(writes.book).toHaveBeenCalledWith({
			kind: "confirm",
			body: {
				templateId: "t1",
				dueAt: DUE,
				expenseId: "new-1",
				amount: "18.50",
				paidOn: "2026-12-02",
			},
		});
		const entries = await outbox.all();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			clientId: "new-1",
			entity: "recurring",
			kind: "confirm",
			targetId: "t1",
			baseVersion: V2,
			payload: { dueAt: DUE, title: "Netflix", amount: "18.50" },
		});
		expect(entries[0]?.state).toBe("pending");
	});

	it("keeps a skip a skip, with no expense id, and a poster's entry a poster's", async () => {
		const { writes, outbox } = setup();
		await park(
			outbox,
			{ origin: "poster", payload: { dueAt: DUE, title: "Netflix" } },
			"skip",
		);
		const plan = await planRebase({ outbox, writes, clientId: "c1" });
		await commitRebase({
			outbox,
			writes,
			clientId: "c1",
			plan: plan as NonNullable<typeof plan>,
		});
		expect(writes.book).toHaveBeenCalledWith({
			kind: "skip",
			body: { templateId: "t1", dueAt: DUE },
		});
		expect((await outbox.all())[0]).toMatchObject({
			kind: "skip",
			origin: "poster",
			baseVersion: V2,
		});
	});

	it("does nothing when the entry is not parked any more", async () => {
		const { writes, outbox } = setup();
		await park(outbox);
		const plan = await planRebase({ outbox, writes, clientId: "c1" });
		await outbox.discard("c1");
		expect(
			await commitRebase({
				outbox,
				writes,
				clientId: "c1",
				plan: plan as NonNullable<typeof plan>,
			}),
		).toBeNull();
	});
});
