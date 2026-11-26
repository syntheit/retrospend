/**
 * Client ids and template stamps on recurring writes (slice-device-recurring.md,
 * PR4), on the real transports: the web's tRPC `recurring.*` and v1
 * `/recurring`, with the preview twins. The base case is the characterization
 * file's: home ARS, preferred USD type blue (1 USD = 1,545 ARS on Nov 30; the
 * official 1,050 on Dec 1 is newer, so only the preferred type picks blue), a
 * monthly USD 20 template on the 1st due 2026-12-01T03:00Z in Buenos Aires,
 * "now" 2026-12-01T12:00Z. A post books 20 * 1,545 = ARS 30,900.00 and the
 * template steps to 2027-01-01T03:00Z. Templates start with updatedAt
 * 2026-11-01T00:00Z (STAMPED), so any write moves the stamp.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { expectBody } from "~/server/api/v1/core/__tests__/harness";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import {
	arsUser,
	booked,
	iso,
	STAMPED,
	setRates,
	templateState,
	trpcFor,
	usdTemplate,
	v1For,
} from "./recurring-write-kit";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const NOW = "2026-12-01T12:00:00.000Z";
const DUE = "2026-12-01T03:00:00.000Z";
const NEXT = "2027-01-01T03:00:00.000Z";
const STAMP = iso(STAMPED);
const OLD_STAMP = "2026-10-15T00:00:00.000Z";
const CHANGED = "Recurring expense changed";

const at = (instant: string) =>
	vi.useFakeTimers({ toFake: ["Date"], now: new Date(instant) });

beforeAll(async () => {
	await setRates([
		["2026-11-01", "ARS", "blue", "1500"],
		["2026-11-30", "ARS", "blue", "1545"],
		["2026-12-01", "ARS", "official", "1050"],
	]);
});
afterEach(() => vi.useRealTimers());

const manual = (userId: string, data = {}) =>
	usdTemplate(userId, { autoPay: false, ...data });

async function expectRefusal(
	res: Response,
	[status, code]: readonly [number, string],
	detail?: string,
) {
	const body = (await res.json()) as unknown;
	expect(res.status, JSON.stringify(body)).toBe(status);
	expect(body).toMatchObject({ status, code, ...(detail && { detail }) });
}

type Trpc = Awaited<ReturnType<typeof trpcFor>>;
const confirmViaTrpc = (
	trpc: Trpc,
	id: string,
	expectedUpdatedAt?: string,
	dueAt = DUE,
) =>
	trpc.recurring.confirmAndCreate({
		id,
		dueDate: new Date(dueAt),
		expectedUpdatedAt,
	});
const skipViaTrpc = (trpc: Trpc, id: string, expectedUpdatedAt?: string) =>
	trpc.recurring.skip({ id, dueDate: new Date(DUE), expectedUpdatedAt });

describe("confirm with a template stamp", () => {
	it("the stamp the template has books ARS 30,900.00 and answers the stamp after the write", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const v1 = await v1For(me);
		at(NOW);
		const done = await expectBody<{
			confirmed: {
				expenseId: string;
				templateUpdatedAt: string | null;
				expenseUpdatedAt?: string | null;
			};
		}>(
			await v1("POST", `/recurring/${id}/confirm`, {
				dueAt: DUE,
				expectedUpdatedAt: STAMP,
			}),
			contract.recurring.confirm,
		);
		const after = await templateState(id);
		expect(after).toMatchObject({ nextDueDate: NEXT, expenses: 1 });
		expect((await booked(me))[0]).toMatchObject({
			amount: "20",
			homeRate: "1545",
			home: "30900",
		});
		// The answer is the stored stamp, which the write moved.
		expect(done.confirmed.templateUpdatedAt).toBe(after.updatedAt);
		expect(after.updatedAt).not.toBe(STAMP);
		// It also names the booked expense's own updatedAt, as stored (contract 1.12.0).
		const stored = await fixtureDb.expense.findUniqueOrThrow({
			where: { id: done.confirmed.expenseId },
		});
		expect(done.confirmed.expenseUpdatedAt).toBe(iso(stored.updatedAt));
	});

	it("reads the stamp as an instant: a zone offset or a missing millisecond is the same stamp", async () => {
		const me = await arsUser();
		const [a, b] = [await manual(me), await manual(me, { name: "Gym" })];
		const v1 = await v1For(me);
		at(NOW);
		for (const [id, stamp] of [
			[a, "2026-11-01T00:00:00Z"],
			[b, "2026-10-31T21:00:00.000-03:00"],
		] as const)
			await expectBody(
				await v1("POST", `/recurring/${id}/confirm`, {
					dueAt: DUE,
					expectedUpdatedAt: stamp,
				}),
				contract.recurring.confirm,
			);
		expect(await booked(me)).toHaveLength(2);
	});

	it("a stale stamp is 409 recurring_changed on v1, its preview twin and tRPC, and nothing is booked", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const v1 = await v1For(me);
		const trpc = await trpcFor(me);
		at(NOW);
		for (const path of ["confirm", "confirm/preview"])
			await expectRefusal(
				await v1("POST", `/recurring/${id}/${path}`, {
					dueAt: DUE,
					expectedUpdatedAt: OLD_STAMP,
				}),
				[409, "recurring_changed"],
			);
		await expect(confirmViaTrpc(trpc, id, OLD_STAMP)).rejects.toMatchObject({
			code: "CONFLICT",
			message: CHANGED,
		});
		expect(await booked(me)).toEqual([]);
		expect(await templateState(id)).toMatchObject({
			nextDueDate: DUE,
			updatedAt: STAMP,
			expenses: 0,
		});
	});

	it("the next period carries the stamp the last write answered, and the old one is refused", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const v1 = await v1For(me);
		at(NOW);
		const first = await expectBody<{
			confirmed: { templateUpdatedAt: string };
		}>(
			await v1("POST", `/recurring/${id}/confirm`, { dueAt: DUE }),
			contract.recurring.confirm,
		);
		// Jan 1 is due once its day has started in Buenos Aires (03:00Z).
		at("2027-01-01T12:00:00.000Z");
		await expectRefusal(
			await v1("POST", `/recurring/${id}/confirm`, {
				dueAt: NEXT,
				expectedUpdatedAt: STAMP,
			}),
			[409, "recurring_changed"],
		);
		await expectBody(
			await v1("POST", `/recurring/${id}/confirm`, {
				dueAt: NEXT,
				expectedUpdatedAt: first.confirmed.templateUpdatedAt,
			}),
			contract.recurring.confirm,
		);
		expect(await booked(me)).toHaveLength(2);
	});

	it("a period another client posted is already posted, not changed, even with a stale stamp", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const v1 = await v1For(me);
		const trpc = await trpcFor(me);
		at(NOW);
		await expectBody(
			await v1("POST", `/recurring/${id}/confirm`, { dueAt: DUE }),
			contract.recurring.confirm,
		);
		await expectRefusal(
			await v1("POST", `/recurring/${id}/confirm`, {
				dueAt: DUE,
				expectedUpdatedAt: STAMP,
			}),
			[409, "recurring_already_posted"],
		);
		await expect(confirmViaTrpc(trpc, id, STAMP)).rejects.toMatchObject({
			code: "CONFLICT",
			message: "This payment was already confirmed",
		});
		expect(await booked(me)).toHaveLength(1);
	});

	it("a paused template with a stale stamp stays 404", async () => {
		const me = await arsUser();
		const id = await manual(me, { isActive: false });
		const v1 = await v1For(me);
		at(NOW);
		await expectRefusal(
			await v1("POST", `/recurring/${id}/confirm`, {
				dueAt: DUE,
				expectedUpdatedAt: OLD_STAMP,
			}),
			[404, "not_found"],
		);
	});

	it("recurring income takes neither a stamp nor a client id", async () => {
		const me = await arsUser();
		const id = await manual(me, {
			name: "Salary",
			direction: "IN",
			anchorDay: null,
			nextDueDate: new Date("2026-12-01T00:00:00.000Z"),
		});
		const v1 = await v1For(me);
		at(NOW);
		for (const extra of [
			{ expectedUpdatedAt: STAMP },
			{ expenseId: randomUUID() },
		])
			await expectRefusal(
				await v1("POST", `/recurring/${id}/confirm`, {
					dueAt: "2026-12-01T00:00:00.000Z",
					...extra,
				}),
				[400, "bad_request"],
			);
		expect(await booked(me)).toEqual([]);
	});
});

describe("confirm with a client id", () => {
	it("books the entry under the id the client made", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const expenseId = randomUUID();
		const v1 = await v1For(me);
		at(NOW);
		const done = await expectBody<{ confirmed: { expenseId: string } }>(
			await v1("POST", `/recurring/${id}/confirm`, {
				dueAt: DUE,
				expenseId,
			}),
			contract.recurring.confirm,
		);
		expect(done.confirmed.expenseId).toBe(expenseId);
		const row = await fixtureDb.expense.findUniqueOrThrow({
			where: { id: expenseId },
		});
		expect(row.recurringTemplateId).toBe(id);
		expect(row.homeAmount?.toString()).toBe("30900");
	});

	it("a taken id is 409 id_taken, on the confirm and its preview, and the template does not move", async () => {
		const me = await arsUser();
		const [first, second] = [
			await manual(me),
			await manual(me, { name: "Gym" }),
		];
		const taken = randomUUID();
		const v1 = await v1For(me);
		at(NOW);
		await expectBody(
			await v1("POST", `/recurring/${first}/confirm`, {
				dueAt: DUE,
				expenseId: taken,
			}),
			contract.recurring.confirm,
		);
		for (const path of ["confirm", "confirm/preview"])
			await expectRefusal(
				await v1("POST", `/recurring/${second}/${path}`, {
					dueAt: DUE,
					expenseId: taken,
				}),
				[409, "id_taken"],
			);
		expect(await booked(me)).toHaveLength(1);
		expect(await templateState(second)).toMatchObject({
			nextDueDate: DUE,
			updatedAt: STAMP,
			expenses: 0,
		});
	});

	it("a resent confirm whose first try landed is already posted, never a second entry", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const expenseId = randomUUID();
		const v1 = await v1For(me);
		at(NOW);
		const body = { dueAt: DUE, expenseId };
		await expectBody(
			await v1("POST", `/recurring/${id}/confirm`, body),
			contract.recurring.confirm,
		);
		await expectRefusal(await v1("POST", `/recurring/${id}/confirm`, body), [
			409,
			"recurring_already_posted",
		]);
		expect(await booked(me)).toHaveLength(1);
	});
});

describe("skip with a template stamp", () => {
	it("the stamp the template has skips the period and answers the stamp after the write", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const v1 = await v1For(me);
		at(NOW);
		const done = await expectBody<{
			skipped: { templateUpdatedAt: string };
		}>(
			await v1("POST", `/recurring/${id}/skip`, {
				dueAt: DUE,
				expectedUpdatedAt: STAMP,
			}),
			contract.recurring.skip,
		);
		const after = await templateState(id);
		expect(after).toMatchObject({ nextDueDate: NEXT, expenses: 0 });
		expect(done.skipped.templateUpdatedAt).toBe(after.updatedAt);
		expect(after.updatedAt).not.toBe(STAMP);
	});

	it("a stale stamp is 409 recurring_changed on v1, its preview twin and tRPC, and the template stays", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const v1 = await v1For(me);
		const trpc = await trpcFor(me);
		at(NOW);
		for (const path of ["skip", "skip/preview"])
			await expectRefusal(
				await v1("POST", `/recurring/${id}/${path}`, {
					dueAt: DUE,
					expectedUpdatedAt: OLD_STAMP,
				}),
				[409, "recurring_changed"],
			);
		await expect(skipViaTrpc(trpc, id, OLD_STAMP)).rejects.toMatchObject({
			code: "CONFLICT",
			message: CHANGED,
		});
		expect(await templateState(id)).toMatchObject({
			nextDueDate: DUE,
			updatedAt: STAMP,
		});
	});

	it("a paused template with a stale stamp stays 404", async () => {
		const me = await arsUser();
		const id = await manual(me, { isActive: false });
		const v1 = await v1For(me);
		at(NOW);
		await expectRefusal(
			await v1("POST", `/recurring/${id}/skip`, {
				dueAt: DUE,
				expectedUpdatedAt: OLD_STAMP,
			}),
			[404, "not_found"],
		);
	});
});

describe("PATCH is a compare-and-set", () => {
	type Item = { id: string; title: string; updatedAt: string };

	it("the stamp the template has changes it and moves the stamp; without a stamp it still works", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const v1 = await v1For(me);
		at(NOW);
		const edited = await expectBody<Item>(
			await v1("PATCH", `/recurring/${id}`, {
				name: "Rent two",
				expectedUpdatedAt: STAMP,
			}),
			contract.recurring.update,
		);
		expect(edited).toMatchObject({ title: "Rent two" });
		expect(edited.updatedAt).not.toBe(STAMP);
		const again = await expectBody<Item>(
			await v1("PATCH", `/recurring/${id}`, { name: "Rent three" }),
			contract.recurring.update,
		);
		expect(again.title).toBe("Rent three");
	});

	it("a stale stamp is 409 recurring_changed and the template keeps its fields", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const v1 = await v1For(me);
		const trpc = await trpcFor(me);
		at(NOW);
		await expectRefusal(
			await v1("PATCH", `/recurring/${id}`, {
				name: "Lost",
				expectedUpdatedAt: OLD_STAMP,
			}),
			[409, "recurring_changed"],
		);
		await expect(
			trpc.recurring.update({
				id,
				name: "Lost",
				expectedUpdatedAt: OLD_STAMP,
			}),
		).rejects.toMatchObject({ code: "CONFLICT", message: CHANGED });
		const row = await fixtureDb.recurringTemplate.findUniqueOrThrow({
			where: { id },
		});
		expect(row.name).toBe("Rent");
		expect(iso(row.updatedAt)).toBe(STAMP);
	});

	it("two edits that read the same version cannot both land", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const v1 = await v1For(me);
		at(NOW);
		const [a, b] = await Promise.all(
			["A", "B"].map((name) =>
				v1("PATCH", `/recurring/${id}`, { name, expectedUpdatedAt: STAMP }),
			),
		);
		expect([a?.status, b?.status].sort()).toEqual([200, 409]);
		const row = await fixtureDb.recurringTemplate.findUniqueOrThrow({
			where: { id },
		});
		expect(["A", "B"]).toContain(row.name);
	});

	it("a template that is gone is 404 whatever the stamp", async () => {
		const me = await arsUser();
		const v1 = await v1For(me);
		at(NOW);
		await expectRefusal(
			await v1("PATCH", `/recurring/${randomUUID()}`, {
				name: "Nope",
				expectedUpdatedAt: STAMP,
			}),
			[404, "not_found"],
		);
	});
});

describe("create with a client id", () => {
	const body = (id?: string) => ({
		id,
		name: "Gym",
		amount: "20",
		currency: "USD",
		frequency: "MONTHLY",
		nextDueDate: "2026-12-01",
		autoPay: false,
	});

	it("makes the template under that id, and the same id again is 409 id_taken with one template", async () => {
		const me = await arsUser();
		const id = randomUUID();
		const v1 = await v1For(me);
		const item = await expectBody<{ id: string }>(
			await v1("POST", "/recurring", body(id)),
			contract.recurring.create,
			201,
		);
		expect(item.id).toBe(id);
		await expectRefusal(await v1("POST", "/recurring", body(id)), [
			409,
			"id_taken",
		]);
		expect(
			await fixtureDb.recurringTemplate.count({ where: { userId: me } }),
		).toBe(1);
	});

	it("the preview twin takes the id and writes nothing", async () => {
		const me = await arsUser();
		const v1 = await v1For(me);
		await expectBody(
			await v1("POST", "/recurring/preview", body(randomUUID())),
			contract.recurring.previewCreate,
		);
		expect(
			await fixtureDb.recurringTemplate.count({ where: { userId: me } }),
		).toBe(0);
	});
});

describe("tRPC template ids", () => {
	it("takes a uuid: an id nobody has is NOT_FOUND on confirm and skip, not BAD_REQUEST", async () => {
		const me = await arsUser();
		const trpc = await trpcFor(me);
		const uuid = randomUUID();
		at(NOW);
		for (const run of [
			() => confirmViaTrpc(trpc, uuid),
			() => skipViaTrpc(trpc, uuid),
		])
			await expect(run()).rejects.toMatchObject({
				code: "NOT_FOUND",
				message: "Recurring template not found",
			});
	});

	it("a template made on a phone with a uuid id is confirmed, skipped and read from the web", async () => {
		const me = await arsUser();
		const [toConfirm, toSkip] = [randomUUID(), randomUUID()];
		const v1 = await v1For(me);
		for (const id of [toConfirm, toSkip])
			await expectBody(
				await v1("POST", "/recurring", {
					id,
					name: "Gym",
					amount: "20",
					currency: "USD",
					frequency: "MONTHLY",
					nextDueDate: "2026-12-01",
					autoPay: false,
				}),
				contract.recurring.create,
				201,
			);
		const trpc = await trpcFor(me);
		at(NOW);
		expect((await trpc.recurring.get({ id: toConfirm })).id).toBe(toConfirm);
		await confirmViaTrpc(trpc, toConfirm);
		await skipViaTrpc(trpc, toSkip);
		expect(await templateState(toConfirm)).toMatchObject({
			nextDueDate: NEXT,
			expenses: 1,
		});
		expect(await templateState(toSkip)).toMatchObject({
			nextDueDate: NEXT,
			expenses: 0,
		});
	});
	it("the web's delete preview and delete accept a uuid template id", async () => {
		const me = await arsUser();
		const id = await manual(me, { id: randomUUID() });
		const trpc = await trpcFor(me);
		await expect(trpc.recurring.delete.preview({ id })).resolves.toBeDefined();
		await trpc.recurring.delete.save({ id });
		expect(await fixtureDb.recurringTemplate.count({ where: { id } })).toBe(0);
	});
});

/**
 * An edit that commits after the plan read the template and before the write
 * lands: a second connection updates the template's amount (USD 20 to 25) and
 * holds its transaction open, the request plans over the committed row (the
 * old stamp still matches) and then waits on that row lock; the edit commits.
 * Without the stamp in the write's compare the confirm would book USD 20 from
 * the old template, since the due date is unchanged.
 */
describe("an edit that commits between the plan's read and the write", () => {
	async function waitForLockWait() {
		for (let i = 0; i < 100; i++) {
			const [row] = await adminDb.$queryRaw<{ waiting: number }[]>`
				SELECT count(*)::int AS waiting FROM pg_stat_activity
				WHERE wait_event_type = 'Lock' AND datname = current_database()`;
			if (row && row.waiting > 0) return;
			await new Promise((r) => setTimeout(r, 50));
		}
		throw new Error("the request never waited on the template row");
	}

	/** Runs `request` while another transaction holds an uncommitted edit of the template, then commits it. */
	async function racing(
		id: string,
		request: () => Promise<unknown>,
		hold: "edit" | "delete" = "edit",
	) {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let locked!: () => void;
		const ready = new Promise<void>((resolve) => {
			locked = resolve;
		});
		const edit = adminDb.$transaction(async (tx) => {
			if (hold === "delete")
				await tx.recurringTemplate.delete({ where: { id } });
			else
				await tx.recurringTemplate.update({
					where: { id },
					data: { amount: "25" },
				});
			locked();
			await gate;
		});
		await ready;
		const outcome = request().then(
			(value) => ({ value }),
			(error: unknown) => ({ error }),
		);
		try {
			await waitForLockWait();
		} finally {
			release();
			await edit;
		}
		return outcome;
	}

	const untouched = async (me: string, id: string) => {
		expect(await booked(me)).toEqual([]);
		expect(await templateState(id)).toMatchObject({
			nextDueDate: DUE,
			expenses: 0,
		});
		const row = await fixtureDb.recurringTemplate.findUniqueOrThrow({
			where: { id },
		});
		expect(row.amount.toString()).toBe("25");
	};

	it("confirm: v1 answers 409 recurring_changed and books nothing", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const v1 = await v1For(me);
		at(NOW);
		const out = await racing(id, () =>
			v1("POST", `/recurring/${id}/confirm`, {
				dueAt: DUE,
				expectedUpdatedAt: STAMP,
			}),
		);
		await expectRefusal((out as { value: Response }).value, [
			409,
			"recurring_changed",
		]);
		await untouched(me, id);
	});

	it("confirm: tRPC is CONFLICT and books nothing", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const trpc = await trpcFor(me);
		at(NOW);
		const out = await racing(id, () => confirmViaTrpc(trpc, id, STAMP));
		expect((out as { error: unknown }).error).toMatchObject({
			code: "CONFLICT",
			message: CHANGED,
		});
		await untouched(me, id);
	});

	it("skip: v1 answers 409 recurring_changed and the template stays", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const v1 = await v1For(me);
		at(NOW);
		const out = await racing(id, () =>
			v1("POST", `/recurring/${id}/skip`, {
				dueAt: DUE,
				expectedUpdatedAt: STAMP,
			}),
		);
		await expectRefusal((out as { value: Response }).value, [
			409,
			"recurring_changed",
		]);
		await untouched(me, id);
	});

	it("skip: tRPC is CONFLICT and the template stays", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const trpc = await trpcFor(me);
		at(NOW);
		const out = await racing(id, () => skipViaTrpc(trpc, id, STAMP));
		expect((out as { error: unknown }).error).toMatchObject({
			code: "CONFLICT",
			message: CHANGED,
		});
		await untouched(me, id);
	});
	it("a template deleted between the plan and the write is 404 on confirm and skip, with or without a stamp", async () => {
		const me = await arsUser();
		const v1 = await v1For(me);
		const trpc = await trpcFor(me);
		at(NOW);
		const gone = async (run: (id: string) => Promise<unknown>) => {
			const id = await manual(me);
			return racing(id, () => run(id), "delete");
		};
		for (const stamp of [undefined, STAMP]) {
			for (const path of ["confirm", "skip"]) {
				const out = await gone((id) =>
					v1("POST", `/recurring/${id}/${path}`, {
						dueAt: DUE,
						expectedUpdatedAt: stamp,
					}),
				);
				await expectRefusal((out as { value: Response }).value, [
					404,
					"not_found",
				]);
			}
		}
		const viaTrpc = await gone((id) => confirmViaTrpc(trpc, id));
		expect((viaTrpc as { error: unknown }).error).toMatchObject({
			code: "NOT_FOUND",
			message: "Recurring template not found",
		});
		expect(await booked(me)).toEqual([]);
	});
});
