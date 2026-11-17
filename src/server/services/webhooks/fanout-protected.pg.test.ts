/**
 * A protected account's webhooks hear nothing: the fan-out checks the event
 * owner's state on the owner connection, and only an explicit OFF passes.
 * The events feed hides these events too (events-visibility.pg.test.ts); the
 * webhook reader had no check of its own.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	adminDb,
	createTestUser,
	openTransactionsEnded,
} from "~/test/pg-harness";
import { unprotectedAmong } from "~/server/services/protection/now";
import { encryptSecret } from "./secret";
import { fanOutEvents } from "./worker";

async function account(state: "OFF" | "ON") {
	const { user } = await createTestUser();
	if (state === "ON")
		await adminDb.$executeRaw`UPDATE "user" SET "protectionState" = 'ON' WHERE "id" = ${user.id}`;
	const webhook = await adminDb.webhook.create({
		data: {
			id: randomUUID(),
			userId: user.id,
			name: "hook",
			url: "https://hook.site.test/in",
			eventTypes: [],
			secretCipher: encryptSecret("whsec_test"),
			secretStart: "whsec_test",
			createdAt: new Date(Date.now() - 60_000),
		},
	});
	const event = await adminDb.apiEvent.create({
		data: {
			userId: user.id,
			actorUserId: user.id,
			type: "profile.updated",
			payload: { ids: {}, amounts: [], truncated: false },
		},
	});
	return { user, webhook, event };
}

async function fanOutUntilDone(eventId: string) {
	await openTransactionsEnded();
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

const deliveriesOf = (eventId: string) =>
	adminDb.webhookDelivery.findMany({ where: { eventId } });

describe("webhook fan-out and protection", () => {
	it("makes a delivery for an account with protection off", async () => {
		const a = await account("OFF");
		await fanOutUntilDone(a.event.id);
		expect(await deliveriesOf(a.event.id)).toHaveLength(1);
	});

	it("makes no delivery for a protected account, and still marks the event done", async () => {
		const a = await account("ON");
		await fanOutUntilDone(a.event.id);
		expect(await deliveriesOf(a.event.id)).toEqual([]);
	});

	it("skips an event written before the account turned protection on", async () => {
		const a = await account("OFF");
		await adminDb.$executeRaw`UPDATE "user" SET "protectionState" = 'ON' WHERE "id" = ${a.user.id}`;
		await fanOutUntilDone(a.event.id);
		expect(await deliveriesOf(a.event.id)).toEqual([]);
	});

	it("counts a user with no row as protected", async () => {
		const off = await account("OFF");
		const on = await account("ON");
		const open = await adminDb.$transaction((tx) =>
			unprotectedAmong(tx, [off.user.id, on.user.id, randomUUID()]),
		);
		expect([...open]).toEqual([off.user.id]);
	});
});
