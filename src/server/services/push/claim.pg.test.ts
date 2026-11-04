/**
 * Two workers sweeping at once must not both send a delivery. The pull reads
 * due ids and then the rows in two queries, so a worker can hold a row that
 * another has claimed since: its nextAttemptAt is then the other's lease, and
 * a claim that only matches on that value would take the row a second time.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { arsUser, type TestUser } from "~/server/api/v1/__tests__/g3-fixtures";
import { newPushData } from "./message";
import { addDevice, adminDb } from "./pg-fixtures";
import { pickDue } from "./pick";
import { CLAIM_LEASE_MS } from "./schedule";
import { claim } from "./worker";

const T0 = new Date("2026-10-26T15:00:00Z");

describe("push claim", () => {
	let user: TestUser;
	let deviceId: string;

	beforeAll(async () => {
		user = await arsUser();
		deviceId = (await addDevice(user.user.id, "APNS")).device.id;
	});

	beforeEach(async () => {
		await adminDb.pushDelivery.deleteMany({});
	});

	const queue = (nextAttemptAt: Date) =>
		adminDb.pushDelivery.create({
			data: {
				userId: user.user.id,
				deviceId,
				eventType: "payment.recorded",
				channel: "payments",
				dedupeKey: randomUUID(),
				payload: newPushData("payment.recorded", {
					entity: { type: "payment", id: "p1" },
					amount: { minor: 1250, currency: "USD" },
				}) as object,
				nextAttemptAt,
				createdAt: T0,
			},
		});
	const reread = (id: string) =>
		adminDb.pushDelivery.findUniqueOrThrow({ where: { id } });

	it("lets one of two workers take a due delivery", async () => {
		const row = await queue(T0);
		const [first] = await pickDue(T0);
		expect(first?.id).toBe(row.id);

		const lease = await claim(first as NonNullable<typeof first>, T0);

		expect(lease).toEqual(new Date(T0.getTime() + CLAIM_LEASE_MS));
		expect((await reread(row.id)).nextAttemptAt).toEqual(lease);
	});

	it("refuses a row that another worker claimed after this one's first query", async () => {
		const row = await queue(T0);
		const [stale] = await pickDue(T0);
		expect(stale?.id).toBe(row.id);
		// Worker A claims between worker B's id query and B's row read.
		const leaseA = await claim(stale as NonNullable<typeof stale>, T0);
		expect(leaseA).not.toBeNull();
		const seenByB = await reread(row.id);
		expect(seenByB.nextAttemptAt).toEqual(leaseA);

		expect(await claim(seenByB, T0)).toBeNull();

		// A's lease is untouched, so A's settle still finds it.
		expect((await reread(row.id)).nextAttemptAt).toEqual(leaseA);
	});

	it("refuses a retry before its backoff ends, and takes it after", async () => {
		const backoffEnds = new Date(T0.getTime() + 30_000);
		const row = await queue(backoffEnds);

		expect(await claim(row, T0)).toBeNull();
		expect((await reread(row.id)).nextAttemptAt).toEqual(backoffEnds);

		expect(await claim(row, backoffEnds)).not.toBeNull();
	});

	it("takes a delivery again once its lease has run out", async () => {
		const row = await queue(T0);
		const lease = await claim(row, T0);
		const afterLease = new Date(T0.getTime() + CLAIM_LEASE_MS + 1);

		expect(await claim(await reread(row.id), afterLease)).toEqual(
			new Date(afterLease.getTime() + CLAIM_LEASE_MS),
		);
		expect(lease).not.toBeNull();
	});
});
