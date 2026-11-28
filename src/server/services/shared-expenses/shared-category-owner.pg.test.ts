/**
 * The category on a shared expense is the writer's own (or none, or the one it
 * already has). ARS 90 split equally, so each of two people owes 45. Sofia
 * owns Dining, Martin owns Gym, Lucia is on nothing of theirs. Every path that
 * writes a category onto a shared row is tried with Martin's Gym as Sofia: v1
 * add, edit and undo, the web's add, edit and revert, the old router, a guest
 * and a correction. Each refusal leaves the row as it was.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { sharedTransactionRouter } from "~/server/api/routers/shared-transaction";
import { createCallerFactory } from "~/server/api/trpc";
import {
	arsUser,
	ref,
	seedProject,
	seedRates,
	seedShare,
	type TestUser,
} from "~/server/api/v1/__tests__/g3-fixtures";
import {
	asMobile,
	call,
	expectBody,
	expectProblem,
} from "~/server/api/v1/core/__tests__/harness";
import { assertSharedRowCategory } from "~/server/services/category/own";
import { sharedTx, shareOf } from "~/server/services/category/__tests__/merge-kit";
import { DAY, makeWorld, type World } from "~/server/services/entry/__tests__/expense-write-kit";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import { seedExpense, seedGuest, seedTrip } from "../project/__tests__/trip-fixture";
import { SharedTransactionService } from "./transaction.service";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));
vi.mock("~/server/mailer", () => ({ sendEmail: vi.fn(async () => {}) }));

const c = contract["shared-expenses"];
const category = (userId: string, name: string) =>
	fixtureDb.category.create({ data: { name, color: "teal", userId } });
const rowOf = (id: string) =>
	adminDb.sharedTransaction.findUniqueOrThrow({ where: { id } });

describe("v1 shared expenses", () => {
	let sofia: TestUser;
	let martin: TestUser;
	let lucia: TestUser;
	let dining: string;
	let gym: string;
	let asSofia: Record<string, string>;

	const body = (over: Record<string, unknown> = {}) => ({
		amount: "90",
		currency: "ARS",
		description: "Dinner",
		date: "2026-10-10",
		paidBy: { type: "user", id: sofia.user.id },
		splitWith: [
			{ type: "user", id: sofia.user.id },
			{ type: "user", id: martin.user.id },
		],
		splitMode: "EQUAL",
		...over,
	});
	const post = (path: string, payload: unknown) =>
		call(path, { method: "POST", headers: asSofia, body: payload, idempotent: true });
	const put = (path: string, payload: unknown) =>
		call(path, { method: "PUT", headers: asSofia, body: payload, idempotent: true });
	const add = async (over: Record<string, unknown> = {}) =>
		expectBody<{ id: string; undo: string }>(
			await post("/shared-expenses", body(over)),
			c.create,
			201,
		);
	/** A row from before the rule: Sofia's, filed under Martin's Gym. */
	async function legacyRow() {
		const row = await adminDb.sharedTransaction.create({
			data: {
				description: "Old",
				amount: "90",
				currency: "ARS",
				date: new Date("2026-10-10"),
				categoryId: gym,
				paidByType: "user",
				paidById: sofia.user.id,
				createdByType: "user",
				createdById: sofia.user.id,
				splitParticipants: {
					create: [
						{ participantType: "user", participantId: sofia.user.id, shareAmount: "45" },
						{ participantType: "user", participantId: martin.user.id, shareAmount: "45" },
					],
				},
			},
		});
		return row.id;
	}

	beforeAll(async () => {
		await seedRates();
		[sofia, martin, lucia] = [await arsUser(), await arsUser(), await arsUser()];
		asSofia = await asMobile(sofia.user.id);
		dining = (await category(sofia.user.id, "Dining")).id;
		gym = (await category(martin.user.id, "Gym")).id;
	});

	it("adds under her own category, and with none", async () => {
		const own = await add({ categoryId: dining });
		expect((await rowOf(own.id)).categoryId).toBe(dining);
		const none = await add();
		expect((await rowOf(none.id)).categoryId).toBeNull();
	});

	it("refuses another person's category on an add and writes nothing", async () => {
		const id = randomUUID();
		await expectProblem(
			await post("/shared-expenses", body({ id, categoryId: gym })),
			404,
			"not_found",
		);
		await expect(adminDb.sharedTransaction.count({ where: { id } })).resolves.toBe(0);
	});

	it("refuses an id that exists nowhere with the same answer, so it says nothing about who has it", async () => {
		await expectProblem(
			await post("/shared-expenses", body({ categoryId: randomUUID() })),
			404,
			"not_found",
		);
	});

	it("refuses another person's category on an edit and keeps the one the row has", async () => {
		const made = await add({ categoryId: dining });
		await expectProblem(
			await put(`/shared-expenses/${made.id}`, { ...body({ categoryId: gym }), id: made.id }),
			404,
			"not_found",
		);
		expect((await rowOf(made.id)).categoryId).toBe(dining);
	});

	it("keeps a foreign category an old row holds when the edit sends it again, and refuses another one", async () => {
		const id = await legacyRow();
		await expectBody(
			await put(`/shared-expenses/${id}`, {
				...body({ amount: "120", categoryId: gym }),
				id,
			}),
			c.update,
		);
		const kept = await rowOf(id);
		expect(kept.categoryId).toBe(gym);
		expect(Number(kept.amount)).toBe(120);

		const other = (await category(martin.user.id, "Rent")).id;
		await expectProblem(
			await put(`/shared-expenses/${id}`, { ...body({ categoryId: other }), id }),
			404,
			"not_found",
		);
		expect((await rowOf(id)).categoryId).toBe(gym);
	});

	it("clears a foreign category on an edit that names none", async () => {
		const id = await legacyRow();
		await expectBody(
			await put(`/shared-expenses/${id}`, { ...body(), id }),
			c.update,
		);
		expect((await rowOf(id)).categoryId).toBeNull();
	});

	it("undoes an edit back to the foreign category the row held, which the server's own token carries", async () => {
		const id = await legacyRow();
		const edited = await expectBody<{ undo: string }>(
			await put(`/shared-expenses/${id}`, { ...body({ categoryId: dining }), id }),
			c.update,
		);
		expect((await rowOf(id)).categoryId).toBe(dining);
		await expectBody(await post("/shared-expenses/undo", { token: edited.undo }), c.undo);
		expect((await rowOf(id)).categoryId).toBe(gym);
	});

	it("does not show Sofia's Dining to Lucia when Martin tries to file it on a split with her", async () => {
		// Martin is on Sofia's Dining split, so he can read the category (K7).
		const seen = await sharedTx(sofia.user.id, dining);
		await shareOf(seen.id, sofia.user.id, null);
		await shareOf(seen.id, martin.user.id, null);
		await expect(
			martin.db.category.findUnique({ where: { id: dining } }),
		).resolves.not.toBeNull();

		const asMartin = await asMobile(martin.user.id);
		const attempt = await call("/shared-expenses", {
			method: "POST",
			headers: asMartin,
			idempotent: true,
			body: {
				...body({ categoryId: dining, description: "Not yours" }),
				paidBy: { type: "user", id: martin.user.id },
				splitWith: [
					{ type: "user", id: martin.user.id },
					{ type: "user", id: lucia.user.id },
				],
			},
		});
		await expectProblem(attempt, 404, "not_found");
		await expect(
			lucia.db.category.findUnique({ where: { id: dining } }),
		).resolves.toBeNull();
		await expect(
			adminDb.sharedTransaction.count({
				where: { createdById: martin.user.id, categoryId: dining },
			}),
		).resolves.toBe(0);
	});
});

describe("the web's shared expense writes", () => {
	let w: World;
	beforeAll(async () => {
		await seedRates();
		w = await makeWorld();
	});
	const who = (id: string) => ({ participantType: "user" as const, participantId: id });
	const form = (over: Record<string, unknown> = {}) => ({
		amount: "9000",
		currency: "ARS",
		description: "Cena",
		date: DAY,
		paidBy: who(w.userId),
		splitWith: [who(w.userId), who(w.otherId)],
		splitMode: "EQUAL" as const,
		...over,
	});
	const created = async (over: Record<string, unknown> = {}) =>
		(
			await w.callers.entry.shared.create.save({
				...form(over),
				id: randomUUID(),
			} as never)
		).value.id;

	it("refuses another person's category on add and edit, and keeps her own", async () => {
		await expect(
			w.callers.entry.shared.create.save({
				...form({ categoryId: w.other }),
				id: randomUUID(),
			} as never),
		).rejects.toMatchObject({ code: "FORBIDDEN", message: "Category not found" });
		const id = await created({ categoryId: w.food });
		await expect(
			w.callers.entry.shared.update.save({
				...form({ categoryId: w.other }),
				id,
				notes: null,
				projectId: null,
			} as never),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect((await rowOf(id)).categoryId).toBe(w.food);
	});

	it("checks a revert body like a write: the client's category is its own claim", async () => {
		const id = await created({ categoryId: w.food });
		const saved = await w.callers.entry.shared.update.save({
			...form({ description: "Cena B", categoryId: w.food }),
			id,
			notes: null,
			projectId: null,
		} as never);
		const revert = {
			...saved.value.restore,
			expectedUpdatedAt: saved.value.updatedAt,
		};
		await expect(
			w.callers.entry.shared.revert.save({ ...revert, categoryId: w.other } as never),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		// The flag only a signed token sets is not a field of the request.
		await expect(
			w.callers.entry.shared.revert.save({
				...revert,
				categoryId: w.other,
				restoredFromServerRecord: true,
			} as never),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect((await rowOf(id)).categoryId).toBe(w.food);
		// Her own category passes the same call.
		await w.callers.entry.shared.revert.save(revert as never);
	});

	it("the old router refuses it too", async () => {
		const caller = createCallerFactory(sharedTransactionRouter)({
			session: makeSession({ id: w.userId }) as never,
			db: (await import("~/server/db")).createUserScopedDb(w.userId),
			headers: new Headers(),
		} as never);
		await expect(
			caller.create({
				amount: 90,
				currency: "ARS",
				description: "Old router",
				date: new Date(),
				categoryId: w.other,
				paidBy: who(w.userId),
				splitWith: [who(w.userId), who(w.otherId)],
				splitMode: "EQUAL",
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			adminDb.sharedTransaction.count({
				where: { createdById: w.userId, categoryId: w.other },
			}),
		).resolves.toBe(0);
	});
});

describe("an editor's own category on someone else's split", () => {
	// The write rule is the read rule: a category is shown on a split its owner
	// created or is a person on, so an editor sets theirs only on such a split.
	it("is taken when the editor is a person on it, refused when they are not on it and did not create it", async () => {
		const trip = await seedTrip();
		const ben = {
			participantType: "user" as const,
			participantId: trip.ben.user.id,
		};
		const service = new SharedTransactionService(adminDb, ben);
		const mine = (await category(trip.ben.user.id, "Bens")).id;
		// Hotel: Ana created it, Ben is on it. Boat: Cam created it, Ben is not on it.
		await service.update({ id: trip.expenses.hotel.id, categoryId: mine });
		expect((await rowOf(trip.expenses.hotel.id)).categoryId).toBe(mine);
		await expect(
			service.update({ id: trip.expenses.boat.id, categoryId: mine }),
		).rejects.toMatchObject({ message: "Category not found" });
		expect((await rowOf(trip.expenses.boat.id)).categoryId).toBeNull();
	});

	it("is taken when the edit also puts the editor on the split", async () => {
		const trip = await seedTrip();
		const ben = {
			participantType: "user" as const,
			participantId: trip.ben.user.id,
		};
		const mine = (await category(trip.ben.user.id, "Bens")).id;
		const people = [trip.refs.C, trip.refs.A].map((r) => ({
			participantType: r.type,
			participantId: r.id,
		}));
		const service = new SharedTransactionService(adminDb, ben);
		await expect(
			service.update({
				id: trip.expenses.boat.id,
				categoryId: mine,
				splitMode: "EQUAL",
				splitWith: people,
			}),
		).rejects.toMatchObject({ message: "Category not found" });
		await service.update({
			id: trip.expenses.boat.id,
			categoryId: mine,
			splitMode: "EQUAL",
			splitWith: [...people, ben],
		});
		expect((await rowOf(trip.expenses.boat.id)).categoryId).toBe(mine);
	});
});

describe("an edit that replaces the people", () => {
	it("counts the people after the edit: an editor who removes himself cannot set his own category, and the same edit without a category passes", async () => {
		const trip = await seedTrip();
		const ben = {
			participantType: "user" as const,
			participantId: trip.ben.user.id,
		};
		const mine = (await category(trip.ben.user.id, "Bens")).id;
		// Ana created it; Ben is on it today (with Ana).
		const split = await seedExpense(trip.project.id, {
			description: "Lunch",
			amount: "20",
			currency: "BRL",
			date: "2026-10-14",
			paidBy: trip.refs.A,
			splits: [
				{ ...trip.refs.A, share: "10" },
				{ ...trip.refs.B, share: "10" },
			],
		});
		const people = [trip.refs.A, trip.refs.C].map((r) => ({
			participantType: r.type,
			participantId: r.id,
		}));
		const service = new SharedTransactionService(adminDb, ben);
		const edit = { id: split.id, splitMode: "EQUAL" as const, splitWith: people };
		await expect(
			service.update({ ...edit, categoryId: mine }),
		).rejects.toMatchObject({ message: "Category not found" });
		expect((await rowOf(split.id)).categoryId).toBeNull();
		await service.update(edit);
		const left = await adminDb.splitParticipant.findMany({
			where: { transactionId: split.id },
		});
		expect(left.map((p) => p.participantId).sort()).toEqual(
			[trip.ana.user.id, trip.cam.user.id].sort(),
		);
	});
});

describe("a guest", () => {
	it("has no category: none or the one the row has, nothing else", async () => {
		const trip = await seedTrip();
		const { guest } = await seedGuest(trip);
		const me = { participantType: "guest" as const, participantId: guest.id };
		const ana = { participantType: "user" as const, participantId: trip.ana.user.id };
		const hers = (await category(trip.ana.user.id, "Hers")).id;
		const service = new SharedTransactionService(adminDb, me);
		const input = (extra: object = {}) => ({
			amount: 30,
			currency: "BRL",
			description: "Taxi",
			date: new Date(),
			paidBy: me,
			splitWith: [me, ana],
			splitMode: "EQUAL" as const,
			projectId: trip.project.id,
			...extra,
		});

		await expect(service.create(input({ categoryId: hers }))).rejects.toMatchObject({
			message: "Category not found",
		});
		const made = await service.create(input());
		const id = made.transaction.id;
		await expect(service.update({ id, categoryId: hers })).rejects.toMatchObject({
			message: "Category not found",
		});
		expect((await rowOf(id)).categoryId).toBeNull();

		// A row Ana filed under her category: a guest's edit that leaves it alone passes.
		await adminDb.sharedTransaction.update({ where: { id }, data: { categoryId: hers } });
		await service.update({ id, description: "Cab" });
		await service.update({ id, categoryId: hers, description: "Cab 2" });
		expect(await rowOf(id)).toMatchObject({ categoryId: hers, description: "Cab 2" });
	});
});

describe("the rule itself", () => {
	it("gives a guest or shadow no category even when their id is a user's", async () => {
		// The lookup is by user id, so this is the only guard that stops a
		// participant whose id equals a user's id; the other tests never reach it.
		const owner = await arsUser();
		const mine = (await category(owner.user.id, "Mine")).id;
		for (const participantType of ["guest", "shadow"] as const)
			await expect(
				assertSharedRowCategory(
					adminDb,
					{ participantType, participantId: owner.user.id },
					mine,
					{ writerOnSplit: true },
				),
			).rejects.toMatchObject({ message: "Category not found" });
		await expect(
			assertSharedRowCategory(
				adminDb,
				{ participantType: "user", participantId: owner.user.id },
				mine,
				{ writerOnSplit: true },
			),
		).resolves.toBeUndefined();
		// Their own category, but not on the split: refused (the write rule is the read rule).
		await expect(
			assertSharedRowCategory(
				adminDb,
				{ participantType: "user", participantId: owner.user.id },
				mine,
				{ writerOnSplit: false },
			),
		).rejects.toMatchObject({ message: "Category not found" });
	});
});

describe("a correction", () => {
	let sofia: TestUser;
	let martin: TestUser;
	let asSofia: Record<string, string>;
	let split: string;
	let gym: string;
	const correct = (categoryId: string | null, amount = "20000") =>
		call(`/shared-expenses/${split}/corrections`, {
			method: "POST",
			headers: asSofia,
			idempotent: true,
			body: {
				description: "Correction to Shared",
				amount,
				paidBy: { type: "user", id: sofia.user.id },
				categoryId,
				splitMode: "EXACT",
				splitWith: [
					{ type: "user", id: martin.user.id, shareAmount: amount },
					{ type: "user", id: sofia.user.id, shareAmount: "0" },
				],
				correctionId: randomUUID(),
			},
		});

	beforeAll(async () => {
		await seedRates();
		[sofia, martin] = [await arsUser(), await arsUser()];
		asSofia = await asMobile(sofia.user.id);
		gym = (await category(martin.user.id, "Gym")).id;
		const trip = await seedProject(sofia, [{ user: martin, role: "EDITOR" }]);
		split = (
			await seedShare(ref(sofia), ref(martin), "18000", "ARS", { projectId: trip })
		).id;
		await adminDb.sharedTransaction.update({
			where: { id: split },
			data: { isLocked: true },
		});
	});

	it("refuses another person's category and writes no row", async () => {
		const before = await adminDb.sharedTransaction.count();
		await expectProblem(await correct(gym), 404, "not_found");
		expect(await adminDb.sharedTransaction.count()).toBe(before);
	});

	it("keeps the category the original holds when only the amount is corrected", async () => {
		await adminDb.sharedTransaction.update({
			where: { id: split },
			data: { categoryId: gym },
		});
		const done = await expectBody<{ correctionIds: string[] }>(
			await correct(gym),
			contract.corrections.correct,
			201,
		);
		expect(done.correctionIds).toHaveLength(1);
		expect(
			(await rowOf(done.correctionIds[0] as string)).categoryId,
		).toBe(gym);
	});
});
