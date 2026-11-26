import type { RetrospendClient } from "@retrospend/api-client";
import { type TemplateSeen, templateSeenOf } from "@retrospend/engine/device";
import { createOutbox, type Outbox } from "@/data/outbox";
import { confirm } from "@/data/outboxFixtures";
import { createMemoryStore } from "@/data/store";
import { resolveParked } from "./parked-resolve";
import {
	apiTransport,
	createEntrySender,
	forgetNotFound,
	PARKED_NOT_FOUND,
	RECURRING_ALREADY_POSTED,
	RECURRING_CHANGED,
} from "./send";

// A parked recurring confirm or skip resolves only from the template a later
// pull left. Poster entries leave quietly; what a person typed is never
// dropped without a word.

const mockSince = jest.fn();
jest.mock("@/data/deviceWrites", () => ({
	deviceWrites: () => ({ templateSince: mockSince }),
}));

const api = {} as RetrospendClient;
const STAMP = "2026-11-18T10:00:00.000Z";
const DUE = "2026-12-01T03:00:00.000Z";

const seen = (over: Partial<Extract<TemplateSeen, { found: true }>> = {}) =>
	({
		found: true,
		paused: false,
		passed: false,
		posted: false,
		...over,
	}) as TemplateSeen;

const GONE: TemplateSeen = { found: false };

/** One parked entry of `t1`, answered `reason`; returns what Sync issues would show. */
async function parked(
	reason: string,
	over: { origin?: "poster"; kind?: "confirm" | "skip" } = {},
) {
	const outbox: Outbox = createOutbox(createMemoryStore(), "scope");
	await outbox.enqueue({
		...confirm("c1", "t1", STAMP, {
			...(over.origin ? { origin: over.origin } : {}),
		}),
		kind: over.kind ?? "confirm",
	});
	await outbox.markConflict("c1", reason);
	const [entry] = await outbox.all();
	return { outbox, entry: entry as NonNullable<typeof entry> };
}

beforeEach(() => {
	mockSince.mockReset();
	forgetNotFound("c1");
});

describe("a parked 404 of a recurring write", () => {
	it("stays parked, Couldn't sync with Try again, through a pull begun before the answer", async () => {
		const recurring = {
			confirm: jest.fn(async () => {
				throw Object.assign(new Error("nf"), {
					status: 404,
					code: PARKED_NOT_FOUND,
				});
			}),
		};
		const outbox = createOutbox(createMemoryStore(), "scope");
		await outbox.enqueue(confirm("c1", "t1", STAMP));
		const [entry] = await outbox.all();
		// The 404 arrives while pull 7 is the latest begun.
		await createEntrySender(
			apiTransport({ recurring } as never as RetrospendClient),
			{ pullsBegun: () => 7 },
		)(entry as never);
		await outbox.markConflict("c1", PARKED_NOT_FOUND);
		const [parkedEntry] = await outbox.all();
		let finished = 7;
		mockSince.mockImplementation(async (_id, pull: number) =>
			finished > pull ? GONE : null,
		);
		expect(
			await resolveParked(outbox, api, parkedEntry as never),
		).toMatchObject({ clientId: "c1", gone: false, retryable: true });
		expect(mockSince).toHaveBeenCalledWith("t1", 7, new Date(DUE), "c1");
		// Pull 8 began after the answer and finished without the template.
		finished = 8;
		expect(
			await resolveParked(outbox, api, parkedEntry as never),
		).toMatchObject({ gone: true, retryable: false });
	});

	it("absent: a poster entry retires and takes its run's later entries along, a person's skip retires, a person's confirm says Deleted on another device", async () => {
		const poster = await parked(PARKED_NOT_FOUND, { origin: "poster" });
		await poster.outbox.enqueue(
			confirm("c2", "t1", { after: "c1" }, { origin: "poster" }),
		);
		mockSince.mockResolvedValue(GONE);
		expect(await resolveParked(poster.outbox, api, poster.entry)).toBeNull();
		expect(await poster.outbox.all()).toEqual([]);

		const skip = await parked(PARKED_NOT_FOUND, { kind: "skip" });
		expect(await resolveParked(skip.outbox, api, skip.entry)).toBeNull();
		expect(await skip.outbox.all()).toEqual([]);

		const person = await parked(PARKED_NOT_FOUND);
		expect(await resolveParked(person.outbox, api, person.entry)).toMatchObject(
			{ gone: true, retryable: false },
		);
		expect(await person.outbox.all()).toHaveLength(1);
	});

	it("paused: a poster entry retires, a person's entry says Changed on another device with Discard only", async () => {
		mockSince.mockResolvedValue(seen({ paused: true }));
		const poster = await parked(PARKED_NOT_FOUND, { origin: "poster" });
		expect(await resolveParked(poster.outbox, api, poster.entry)).toBeNull();
		expect(await poster.outbox.all()).toEqual([]);

		const person = await parked(PARKED_NOT_FOUND);
		expect(await resolveParked(person.outbox, api, person.entry)).toMatchObject(
			{ gone: false, retryable: false },
		);
		expect(await person.outbox.all()).toHaveLength(1);
	});

	it("back by Undo, present and still due: it stays Couldn't sync with Try again, poster or person", async () => {
		mockSince.mockResolvedValue(seen());
		for (const origin of [undefined, "poster" as const]) {
			const { outbox, entry } = await parked(PARKED_NOT_FOUND, { origin });
			expect(await resolveParked(outbox, api, entry)).toMatchObject({
				gone: false,
				retryable: true,
			});
			expect(await outbox.all()).toHaveLength(1);
		}
	});

	it("a next due date past the period retires a poster entry and shows a person's as Changed, Discard only", async () => {
		mockSince.mockResolvedValue(seen({ passed: true }));
		const poster = await parked(PARKED_NOT_FOUND, { origin: "poster" });
		expect(await resolveParked(poster.outbox, api, poster.entry)).toBeNull();
		const person = await parked(PARKED_NOT_FOUND);
		expect(await resolveParked(person.outbox, api, person.entry)).toMatchObject(
			{ retryable: false },
		);
	});
});

describe("a person's entry answered already posted", () => {
	it("retires without a word only when the pull shows the period's expense", async () => {
		mockSince.mockResolvedValue(seen({ passed: true, posted: true }));
		const { outbox, entry } = await parked(RECURRING_ALREADY_POSTED);
		expect(await resolveParked(outbox, api, entry)).toBeNull();
		expect(await outbox.all()).toEqual([]);
	});

	it("parks as Changed with Discard only when the template moved but no expense is dated the period", async () => {
		mockSince.mockResolvedValue(seen({ passed: true, posted: false }));
		const { outbox, entry } = await parked(RECURRING_ALREADY_POSTED);
		expect(await resolveParked(outbox, api, entry)).toMatchObject({
			retryable: false,
		});
		expect(await outbox.all()).toHaveLength(1);
	});

	it("a skip, which books no expense, is never retired on a guess", async () => {
		mockSince.mockResolvedValue(seen({ passed: true, posted: true }));
		const { outbox, entry } = await parked(RECURRING_ALREADY_POSTED, {
			kind: "skip",
		});
		expect(await resolveParked(outbox, api, entry)).toMatchObject({
			retryable: false,
		});
		expect(await outbox.all()).toHaveLength(1);
	});

	it("stays Discard only when the template is still due on the period", async () => {
		mockSince.mockResolvedValue(seen());
		const { outbox, entry } = await parked(RECURRING_ALREADY_POSTED);
		expect(await resolveParked(outbox, api, entry)).toMatchObject({
			retryable: false,
		});
	});

	it("waits for a pull: with none finished it stays, and sending it again is not offered", async () => {
		mockSince.mockResolvedValue(null);
		const { outbox, entry } = await parked(RECURRING_ALREADY_POSTED);
		expect(await resolveParked(outbox, api, entry)).toMatchObject({
			retryable: false,
		});
		expect(await outbox.all()).toHaveLength(1);
	});
});

describe("a person's paid-on confirm answered already posted", () => {
	// Dec 1 period paid on Nov 29: the expense is dated the paid-on day, so only
	// its id (the entry's client id) proves this write is the one that landed.
	const pulled = (expenses: Record<string, unknown>) => {
		const template = {
			id: "t1",
			isActive: true,
			nextDueDate: new Date("2027-01-01T03:00:00.000Z"),
		};
		mockSince.mockImplementation(
			async (id: string, _pull: number, dueAt: Date, expenseId: string) =>
				templateSeenOf(
					{
						get: (_table: string, key: string) =>
							_table === "recurringTemplates" ? template : expenses[key],
						list: () => [],
					} as never,
					id,
					dueAt,
					expenseId,
				),
		);
	};

	it("its own booked expense, dated the paid-on day, retires it without a word", async () => {
		pulled({
			c1: {
				id: "c1",
				date: new Date("2026-11-29T03:00:00.000Z"),
				recurringTemplateId: "t1",
			},
		});
		const { outbox, entry } = await parked(RECURRING_ALREADY_POSTED);
		expect(await resolveParked(outbox, api, entry)).toBeNull();
		expect(await outbox.all()).toEqual([]);
	});

	it("another expense of the template for the period is not its own: Changed, Discard only", async () => {
		pulled({
			other: {
				id: "other",
				date: new Date(DUE),
				recurringTemplateId: "t1",
			},
		});
		const { outbox, entry } = await parked(RECURRING_ALREADY_POSTED);
		expect(await resolveParked(outbox, api, entry)).toMatchObject({
			retryable: false,
		});
		expect(await outbox.all()).toHaveLength(1);
	});
});

describe("a person's entry answered changed", () => {
	it("keeps Try again while the template is present and still due, and is Discard only once the period moved", async () => {
		const { outbox, entry } = await parked(RECURRING_CHANGED);
		mockSince.mockResolvedValue(seen());
		expect(await resolveParked(outbox, api, entry)).toMatchObject({
			gone: false,
			retryable: true,
		});
		mockSince.mockResolvedValue(seen({ passed: true }));
		expect(await resolveParked(outbox, api, entry)).toMatchObject({
			retryable: false,
		});
		mockSince.mockResolvedValue(GONE);
		expect(await resolveParked(outbox, api, entry)).toMatchObject({
			gone: true,
			retryable: false,
		});
	});

	it("an entry parked for any other reason is read as it was, with no pull read", async () => {
		const { outbox, entry } = await parked("id_taken");
		expect(await resolveParked(outbox, api, entry)).toMatchObject({
			reason: "id_taken",
			retryable: true,
		});
		expect(mockSince).not.toHaveBeenCalled();
	});
});
