/**
 * Two workers sweeping at once must not both post a webhook delivery. The
 * pull reads due ids and then the rows in two queries, so a worker can hold a
 * row that another has claimed since: its nextAttemptAt is then the other's
 * lease, and a claim that only matches on that value would take it again.
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { CLAIM_LEASE_MS } from "./schedule";
import { encryptSecret } from "./secret";
import { claim, pickDue } from "./worker";

const T0 = new Date("2026-10-26T15:00:00Z");

describe("webhook claim", () => {
	beforeEach(async () => {
		await adminDb.webhookDelivery.deleteMany({});
	});

	async function queue(nextAttemptAt: Date) {
		const { user } = await createTestUser();
		const hook = await adminDb.webhook.create({
			data: {
				id: randomUUID(),
				userId: user.id,
				name: "claim",
				url: "http://claim.site.test/hook",
				eventTypes: [],
				secretCipher: encryptSecret("whsec_test"),
				secretStart: "whsec_test",
			},
		});
		const event = await adminDb.apiEvent.create({
			data: {
				userId: user.id,
				actorUserId: user.id,
				type: "expense.created",
				payload: { ids: {}, amounts: [], truncated: false },
				fannedOutAt: T0,
			},
		});
		return adminDb.webhookDelivery.create({
			data: {
				webhookId: hook.id,
				userId: user.id,
				eventId: event.id,
				eventType: "expense.created",
				nextAttemptAt,
			},
		});
	}
	const withRelations = (id: string) =>
		adminDb.webhookDelivery.findUniqueOrThrow({
			where: { id },
			include: { webhook: true, event: true },
		});

	it("lets one of two workers take a due delivery", async () => {
		const row = await queue(T0);
		const [first] = await pickDue(T0);
		expect(first?.id).toBe(row.id);

		const lease = await claim(first as NonNullable<typeof first>, T0);

		expect(lease).toEqual(new Date(T0.getTime() + CLAIM_LEASE_MS));
		expect((await withRelations(row.id)).nextAttemptAt).toEqual(lease);
	});

	it("refuses a row that another worker claimed after this one's first query", async () => {
		const row = await queue(T0);
		const [stale] = await pickDue(T0);
		expect(stale?.id).toBe(row.id);
		// Worker A claims between worker B's id query and B's row read.
		const leaseA = await claim(stale as NonNullable<typeof stale>, T0);
		expect(leaseA).not.toBeNull();
		const seenByB = await withRelations(row.id);
		expect(seenByB.nextAttemptAt).toEqual(leaseA);

		expect(await claim(seenByB, T0)).toBeNull();

		// A's lease is untouched, so A's settle still finds it.
		expect((await withRelations(row.id)).nextAttemptAt).toEqual(leaseA);
	});

	it("refuses a retry before its backoff ends, and takes it after", async () => {
		const backoffEnds = new Date(T0.getTime() + 30_000);
		const row = await withRelations((await queue(backoffEnds)).id);

		expect(await claim(row, T0)).toBeNull();
		expect((await withRelations(row.id)).nextAttemptAt).toEqual(backoffEnds);

		expect(await claim(row, backoffEnds)).not.toBeNull();
	});

	it("takes a delivery again once its lease has run out", async () => {
		const row = await withRelations((await queue(T0)).id);
		expect(await claim(row, T0)).not.toBeNull();
		const afterLease = new Date(T0.getTime() + CLAIM_LEASE_MS + 1);

		expect(await claim(await withRelations(row.id), afterLease)).toEqual(
			new Date(afterLease.getTime() + CLAIM_LEASE_MS),
		);
	});
});
