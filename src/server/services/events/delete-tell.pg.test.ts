/**
 * Deleting a shared expense tells the people who were on it. The delete
 * result names them (user and shadow people, never the actor), the event
 * carries them as ids, and the fan-out writes each account a feed copy that
 * names the expense and the actor and nothing else. A retraction (the Undo of
 * an add, right after) names nobody, as its notices are taken back too.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { sharedTransactionRouter } from "~/server/api/routers/shared-transaction";
import { createCallerFactory } from "~/server/api/trpc";
import {
	arsUser,
	seedArsRates,
	TODAY,
} from "~/server/services/accounts/test-fixtures";
import {
	createSharedExpense,
	deleteSharedExpense,
} from "~/server/services/entry/shared.mutation";
import { forUser } from "~/server/services/preview";
import { fanOutEvents } from "~/server/services/webhooks/worker";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { readEventFeed } from "./feed";

beforeAll(seedArsRates);

async function book() {
	const { user } = await arsUser();
	const { user: ben } = await createTestUser();
	const sam = await adminDb.shadowProfile.create({
		data: {
			createdById: user.id,
			name: "Sam",
			email: `sam-${randomUUID()}@pg-test.invalid`,
		},
	});
	const who = (type: "user" | "shadow", id: string) => ({
		participantType: type,
		participantId: id,
	});
	const create = await forUser(user.id).apply(createSharedExpense, {
		amount: 9000,
		currency: "ARS",
		description: "Cena",
		date: TODAY,
		paidBy: who("user", user.id),
		splitWith: [
			who("user", user.id),
			who("user", ben.id),
			who("shadow", sam.id),
		],
		splitMode: "EQUAL",
	});
	return { user, ben, sam, id: create.value.id };
}

const eventsOf = (userId: string, type: string) =>
	adminDb.apiEvent.findMany({ where: { userId, type, sourceEventId: null } });

async function fanOutUntilDone(eventId: string) {
	for (let n = 0; n < 50; n++) {
		await fanOutEvents();
		const row = await adminDb.apiEvent.findUniqueOrThrow({
			where: { id: eventId },
		});
		if (row.fannedOutAt) return;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error("The fan-out never handled the event");
}

describe("deleting a shared expense", () => {
	it("returns the other people on it and writes them into the event", async () => {
		const b = await book();
		await forUser(b.user.id).apply(deleteSharedExpense, {
			id: b.id,
			confirmUnsettled: true,
		});
		const [event] = await eventsOf(b.user.id, "shared_expense.deleted");
		expect(event?.entityId).toBe(b.id);
		expect(event?.payload).toMatchObject({
			ids: { "tell.user.0": b.ben.id, "tell.shadow.0": b.sam.id },
		});
		expect(JSON.stringify(event?.payload)).not.toContain(b.user.id);
		expect(JSON.stringify(event?.payload)).not.toContain("Cena");
	});

	it("reaches the other account's feed once the fan-out has run", async () => {
		const b = await book();
		await forUser(b.user.id).apply(deleteSharedExpense, {
			id: b.id,
			confirmUnsettled: true,
		});
		const [event] = await eventsOf(b.user.id, "shared_expense.deleted");
		await fanOutUntilDone(event?.id as string);
		const feed = await readEventFeed(adminDb, b.ben.id, { limit: 50 });
		const deleted = feed.items.filter(
			(e) => e.type === "shared_expense.deleted",
		);
		expect(deleted).toHaveLength(1);
		expect(deleted[0]).toMatchObject({
			actorUserId: b.user.id,
			entity: { type: "shared_expense", id: b.id },
			data: { ids: {}, amounts: [], truncated: false },
		});
	});

	it("names nobody when it only takes back an add", async () => {
		const b = await book();
		await forUser(b.user.id).apply(deleteSharedExpense, {
			id: b.id,
			confirmUnsettled: true,
			retract: true,
		});
		const [event] = await eventsOf(b.user.id, "shared_expense.deleted");
		expect(event?.payload).toMatchObject({ ids: {} });
	});
});

describe("deleting from the activity list (the older procedure)", () => {
	it("appends the same event for a signed-in user", async () => {
		const b = await book();
		const caller = createCallerFactory(sharedTransactionRouter)({
			db: adminDb,
			session: {
				user: { id: b.user.id, role: "USER", isActive: true, timeZone: "UTC" },
			} as never,
			headers: new Headers(),
		});
		await caller.delete({ id: b.id, confirmUnsettled: true });
		const [event] = await eventsOf(b.user.id, "shared_expense.deleted");
		expect(event?.entityId).toBe(b.id);
		expect(event?.payload).toMatchObject({
			ids: { "tell.user.0": b.ben.id, "tell.shadow.0": b.sam.id },
		});
	});
});
