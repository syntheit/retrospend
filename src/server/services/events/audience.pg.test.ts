/**
 * A write on something two or more people share reaches the others' feeds:
 * the fan-out copies the event to each other person on the entity, as a row
 * of their own that names the entity and the actor and carries no ids or
 * amounts of the actor's (a share, a balance and a category are the actor's
 * business). The copy is what their webhooks and `GET /events` see; it is
 * never pushed again (the push fan-out tells them from the original), never
 * copied further, and written once however often the fan-out runs.
 *
 * Fixture: Sofia pays a dinner that Martin owes in full, Lucia is on it with
 * a share, and a stranger is on nothing.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
	arsUser,
	ref,
	seedShare,
	type TestUser,
} from "~/server/api/v1/__tests__/g3-fixtures";
import { encryptSecret } from "~/server/services/webhooks/secret";
import { fanOutEvents } from "~/server/services/webhooks/worker";
import { adminDb } from "~/test/pg-harness";
import { readEventFeed } from "./feed";

let sofia: TestUser;
let martin: TestUser;
let lucia: TestUser;
let stranger: TestUser;
let dinner: string;

const SECRET_AMOUNTS = {
	ids: { categoryId: "cat_private", accountId: "acc_private" },
	amounts: [{ name: "owed.owedToYou", minor: 100000, currency: "ARS" }],
	truncated: false,
};

beforeAll(async () => {
	[sofia, martin, lucia, stranger] = [
		await arsUser(),
		await arsUser(),
		await arsUser(),
		await arsUser(),
	];
	const tx = await seedShare(ref(sofia), ref(martin), "1000", "ARS");
	await adminDb.splitParticipant.create({
		data: {
			transactionId: tx.id,
			...ref(lucia),
			shareAmount: "250",
			verificationStatus: "ACCEPTED",
		},
	});
	dinner = tx.id;
});

/** Writes an event the way a mutation does, then fans out until it is handled. */
async function write(actor: TestUser, type: string, entityId: string | null) {
	const event = await adminDb.apiEvent.create({
		data: {
			userId: actor.user.id,
			actorUserId: actor.user.id,
			type,
			entityType: entityId ? type.split(".")[0] : null,
			entityId,
			payload: SECRET_AMOUNTS,
		},
	});
	for (let n = 0; n < 50; n++) {
		await fanOutEvents();
		const done = await adminDb.apiEvent.findUniqueOrThrow({
			where: { id: event.id },
		});
		if (done.fannedOutAt) return event;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error("The fan-out never handled the event");
}

/** The feed of `user`, once every copy that should be there has shown. */
async function feedOf(user: TestUser, expected: number) {
	for (let n = 0; n < 50; n++) {
		const feed = await readEventFeed(adminDb, user.user.id, { limit: 200 });
		if (feed.items.length >= expected) return feed.items;
		await new Promise((r) => setTimeout(r, 100));
	}
	return (await readEventFeed(adminDb, user.user.id, { limit: 200 })).items;
}

describe("events reach the other people on a shared entity", () => {
	it("copies a shared expense event to the others on it, without the actor's ids or amounts", async () => {
		const event = await write(sofia, "shared_expense.created", dinner);

		for (const other of [martin, lucia]) {
			const items = await feedOf(other, 1);
			expect(items).toHaveLength(1);
			expect(items[0]).toMatchObject({
				type: "shared_expense.created",
				actorUserId: sofia.user.id,
				entity: { type: "shared_expense", id: dinner },
				data: { ids: {}, amounts: [], truncated: false },
			});
			expect(JSON.stringify(items[0])).not.toContain("cat_private");
			expect(JSON.stringify(items[0])).not.toContain("100000");
		}
		// Sofia's own feed keeps her event, with her figures, and gets no copy.
		const hers = (await feedOf(sofia, 1)).filter((e) => e.id === event.id);
		expect(hers).toHaveLength(1);
		expect(hers[0]?.data.amounts).toHaveLength(1);
		expect(
			await adminDb.apiEvent.count({
				where: { userId: sofia.user.id, sourceEventId: { not: null } },
			}),
		).toBe(0);
	});

	it("tells a person who is not on it nothing", async () => {
		expect(await feedOf(stranger, 0)).toHaveLength(0);
	});

	it("never pushes a copy, and never copies a copy", async () => {
		const copies = await adminDb.apiEvent.findMany({
			where: { userId: martin.user.id, sourceEventId: { not: null } },
		});
		expect(copies.length).toBeGreaterThan(0);
		for (const copy of copies) expect(copy.pushedAt).not.toBeNull();
		// Martin's copy was fanned out too, and made no copies of its own.
		expect(
			await adminDb.apiEvent.count({
				where: {
					sourceEventId: { in: copies.map((c) => c.id) },
				},
			}),
		).toBe(0);
	});

	it("writes a copy once, however often the fan-out runs over the same event", async () => {
		const event = await write(sofia, "shared_expense.updated", dinner);
		// Forced back into the queue: the copy must still not be made twice.
		await adminDb.apiEvent.update({
			where: { id: event.id },
			data: { fannedOutAt: null },
		});
		await write(sofia, "shared_expense.updated", dinner);
		const copies = await adminDb.apiEvent.count({
			where: { userId: martin.user.id, sourceEventId: event.id },
		});
		expect(copies).toBe(1);
	});

	it("gives the other person's webhook the copy", async () => {
		const hook = await adminDb.webhook.create({
			data: {
				id: randomUUID(),
				userId: martin.user.id,
				name: "Mine",
				url: "https://example.test/hook",
				eventTypes: ["shared_expense.*"],
				secretCipher: encryptSecret("whsec_x"),
				secretStart: "whsec_x",
			},
		});
		await write(sofia, "shared_expense.updated", dinner);
		await feedOf(martin, 1);
		for (let n = 0; n < 50; n++) {
			await fanOutEvents();
			if (
				(await adminDb.webhookDelivery.count({
					where: { webhookId: hook.id },
				})) > 0
			)
				break;
			await new Promise((r) => setTimeout(r, 100));
		}
		const deliveries = await adminDb.webhookDelivery.findMany({
			where: { webhookId: hook.id },
			include: { event: true },
		});
		expect(deliveries.length).toBeGreaterThan(0);
		for (const d of deliveries) expect(d.event?.userId).toBe(martin.user.id);
	});

	it("copies a fix request to the person asked, and a payment to the other party", async () => {
		const request = randomUUID();
		await adminDb.fixRequest.create({
			data: {
				id: request,
				transactionId: dinner,
				requestedByType: "user",
				requestedById: martin.user.id,
				askedType: "user",
				askedId: sofia.user.id,
				message: "The total is wrong",
			},
		});
		await write(martin, "fix_request.created", request);
		const asked = (await feedOf(sofia, 1)).filter(
			(e) => e.type === "fix_request.created",
		);
		expect(asked).toHaveLength(1);
		expect(asked[0]).toMatchObject({
			actorUserId: martin.user.id,
			entity: { type: "fix_request", id: request },
		});
		expect(JSON.stringify(asked[0])).not.toContain("The total is wrong");

		const payment = randomUUID();
		await adminDb.payment.create({
			data: {
				id: payment,
				payerType: "user",
				payerId: martin.user.id,
				payeeType: "user",
				payeeId: sofia.user.id,
				amount: "400",
				currency: "ARS",
				paidOn: new Date("2026-10-10"),
				recordedByType: "user",
				recordedById: martin.user.id,
			},
		});
		await write(martin, "payment.recorded", payment);
		const paid = (await feedOf(sofia, 2)).filter(
			(e) => e.type === "payment.recorded",
		);
		expect(paid).toHaveLength(1);
		expect(paid[0]?.entity).toEqual({ type: "payment", id: payment });
	});

	it("copies nothing for an entity the actor has no part in", async () => {
		// A forged entity id: the stranger names Sofia's dinner.
		const before = await adminDb.apiEvent.count({
			where: { sourceEventId: { not: null } },
		});
		await write(stranger, "shared_expense.updated", dinner);
		expect(
			await adminDb.apiEvent.count({ where: { sourceEventId: { not: null } } }),
		).toBe(before);
	});

	it("copies nothing for an event that is not about people's shared things", async () => {
		const before = await adminDb.apiEvent.count({
			where: { sourceEventId: { not: null } },
		});
		await write(sofia, "category.created", null);
		await write(sofia, "expense.created", randomUUID());
		expect(
			await adminDb.apiEvent.count({ where: { sourceEventId: { not: null } } }),
		).toBe(before);
	});
});

describe("both sides of a fix request, and a person who left", () => {
	const copiesOf = (entityId: string, type: string) =>
		adminDb.apiEvent.findMany({
			where: { entityId, type, sourceEventId: { not: null } },
			select: { userId: true, actorUserId: true },
		});

	it("tells the requester the answer, and the person asked the cancel", async () => {
		const request = randomUUID();
		await adminDb.fixRequest.create({
			data: {
				id: request,
				transactionId: dinner,
				requestedByType: "user",
				requestedById: martin.user.id,
				askedType: "user",
				askedId: sofia.user.id,
				message: "Wrong total",
			},
		});
		await write(sofia, "fix_request.answered", request);
		expect(await copiesOf(request, "fix_request.answered")).toEqual([
			{ userId: martin.user.id, actorUserId: sofia.user.id },
		]);
		await write(martin, "fix_request.cancelled", request);
		expect(await copiesOf(request, "fix_request.cancelled")).toEqual([
			{ userId: sofia.user.id, actorUserId: martin.user.id },
		]);
	});

	async function leave(at: Date, withAudit: boolean) {
		const expense = (await seedShare(ref(sofia), ref(martin), "300", "ARS")).id;
		if (withAudit)
			await adminDb.auditLogEntry.create({
				data: {
					actorType: "user",
					actorId: lucia.user.id,
					action: "PARTICIPANT_REMOVED",
					targetType: "SPLIT_PARTICIPANT",
					targetId: expense,
					changes: { selfRemoved: true },
					timestamp: at,
				},
			});
		await write(lucia, "shared_expense.self_removed", expense);
		return expense;
	}

	it("tells the remaining people that someone took themselves off, once the removal is on record", async () => {
		const expense = await leave(new Date(), true);
		const told = (await copiesOf(expense, "shared_expense.self_removed")).map(
			(c) => c.userId,
		);
		expect(told.sort()).toEqual([sofia.user.id, martin.user.id].sort());
	});

	it("tells nobody when there is no removal on record, or it is not from just now", async () => {
		const none = await leave(new Date(), false);
		expect(await copiesOf(none, "shared_expense.self_removed")).toHaveLength(0);
		const old = await leave(new Date(Date.now() - 3600_000), true);
		expect(await copiesOf(old, "shared_expense.self_removed")).toHaveLength(0);
	});
});

describe("a deleted expense still reaches the people who were on it", () => {
	const told = (n: number, type: "user" | "shadow", id: string) => ({
		[`tell.${type}.${n}`]: id,
	});

	/** The delete event as the mutation writes it: the expense is gone, the people ride in the ids. */
	async function deleted(
		ids: Record<string, string>,
		type = "shared_expense.deleted",
	) {
		const gone = randomUUID();
		const event = await adminDb.apiEvent.create({
			data: {
				userId: sofia.user.id,
				actorUserId: sofia.user.id,
				type,
				entityType: "shared_expense",
				entityId: gone,
				payload: { ids, amounts: [], truncated: false },
			},
		});
		for (let n = 0; n < 50; n++) {
			await fanOutEvents();
			const row = await adminDb.apiEvent.findUniqueOrThrow({
				where: { id: event.id },
			});
			if (row.fannedOutAt) break;
			await new Promise((r) => setTimeout(r, 100));
		}
		return { gone, event };
	}

	const copies = (sourceEventId: string) =>
		adminDb.apiEvent.findMany({
			where: { sourceEventId },
			select: {
				userId: true,
				actorUserId: true,
				entityId: true,
				payload: true,
			},
		});

	it("copies it to the users named, a claimed profile's account included, and not to the actor or anyone else", async () => {
		const sam = await adminDb.shadowProfile.create({
			data: {
				createdById: sofia.user.id,
				name: "Sam",
				email: `sam-${randomUUID()}@pg-test.invalid`,
				claimedById: lucia.user.id,
			},
		});
		const unclaimed = await adminDb.shadowProfile.create({
			data: {
				createdById: sofia.user.id,
				name: "Una",
				email: `una-${randomUUID()}@pg-test.invalid`,
			},
		});
		const { gone, event } = await deleted({
			...told(0, "user", martin.user.id),
			...told(1, "user", sofia.user.id),
			...told(0, "shadow", sam.id),
			...told(1, "shadow", unclaimed.id),
		});
		const rows = await copies(event.id);
		expect(rows.map((r) => r.userId).sort()).toEqual(
			[martin.user.id, lucia.user.id].sort(),
		);
		for (const row of rows) {
			expect(row.actorUserId).toBe(sofia.user.id);
			expect(row.entityId).toBe(gone);
			expect(row.payload).toEqual({ ids: {}, amounts: [], truncated: false });
		}
	});

	it("copies a deleted expense with nobody named to nobody", async () => {
		const { event } = await deleted({});
		expect(await copies(event.id)).toHaveLength(0);
	});

	it("honors the names on a delete only, not on an event that merely carries them", async () => {
		const { event } = await deleted(
			told(0, "user", martin.user.id),
			"shared_expense.updated",
		);
		expect(await copies(event.id)).toHaveLength(0);
	});
});

describe("who may write an event", () => {
	it("copies nothing for a row that names someone else as the actor", async () => {
		const event = await adminDb.apiEvent.create({
			data: {
				userId: sofia.user.id,
				actorUserId: martin.user.id,
				type: "shared_expense.updated",
				entityType: "shared_expense",
				entityId: dinner,
				payload: SECRET_AMOUNTS,
			},
		});
		for (let n = 0; n < 50; n++) {
			await fanOutEvents();
			const row = await adminDb.apiEvent.findUniqueOrThrow({
				where: { id: event.id },
			});
			if (row.fannedOutAt) break;
			await new Promise((r) => setTimeout(r, 100));
		}
		expect(
			await adminDb.apiEvent.count({ where: { sourceEventId: event.id } }),
		).toBe(0);
	});

	const draft = (over: Record<string, unknown>) => ({
		userId: sofia.user.id,
		actorUserId: sofia.user.id,
		type: "expense.created",
		payload: { ids: {}, amounts: [], truncated: false },
		...over,
	});

	it("lets the app role append its own first-hand event", async () => {
		await expect(
			sofia.db.apiEvent.create({ data: draft({}), select: { id: true } }),
		).resolves.toBeDefined();
	});

	it("refuses the app role a copy, an event in someone else's name, and one without an actor", async () => {
		for (const over of [
			{ sourceEventId: "some-event" },
			{ actorUserId: martin.user.id },
			{ actorUserId: null },
			{ userId: martin.user.id },
		])
			await expect(
				sofia.db.apiEvent.create({ data: draft(over), select: { id: true } }),
			).rejects.toThrow();
	});
});
