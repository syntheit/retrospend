/**
 * The push worker on Postgres: sending, retries with backoff, dead tokens,
 * recurring reminders and clean-up, with senders that record and answer as
 * told. One test at the end runs the real Web Push sender against a local
 * server and decrypts what arrives.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	arsUser,
	ref,
	seedShare,
	type TestUser,
} from "~/server/api/v1/__tests__/g3-fixtures";
import { getServerInfo } from "~/server/services/api-v1/platform.service";
import { loadPushConfig } from "./config";
import { newPushData } from "./message";
import {
	addDevice,
	adminDb,
	allSendersConfig,
	appendOutboxEvent,
	deliveriesOf,
	recordingSenders,
	sweepUntilPushed,
} from "./pg-fixtures";
import { raiseRecurringDue } from "./recurring";
import { BASE_DELAY_MS, CLAIM_LEASE_MS, MAX_ATTEMPTS } from "./schedule";
import { decryptWebPush, mockHttp, NO_PUSH, newVapidEnv } from "./test-helpers";
import { processDuePushes, prunePushData, runPushWorker } from "./worker";

const config = allSendersConfig();
const T0 = new Date("2026-10-26T15:00:00Z");

async function queue(
	userId: string,
	deviceId: string,
	over: Partial<{
		dedupeKey: string;
		payload: unknown;
		createdAt: Date;
		nextAttemptAt: Date;
	}> = {},
) {
	return adminDb.pushDelivery.create({
		data: {
			userId,
			deviceId,
			eventType: "payment.recorded",
			channel: "payments",
			dedupeKey: over.dedupeKey ?? randomUUID(),
			payload: (over.payload ??
				newPushData("payment.recorded", {
					entity: { type: "payment", id: "p1" },
					amount: { minor: 1250, currency: "USD" },
				})) as object,
			nextAttemptAt: over.nextAttemptAt ?? T0,
			createdAt: over.createdAt ?? T0,
		},
	});
}

const fresh = (id: string) =>
	adminDb.pushDelivery.findUniqueOrThrow({ where: { id } });

describe("push worker", () => {
	let martin: TestUser;
	let sofia: TestUser;

	// The database is shared by every pg test file, and the worker takes any
	// due delivery, so other files' leftovers would be counted and sent here.
	beforeEach(async () => {
		await adminDb.pushDelivery.deleteMany({});
	});

	beforeAll(async () => {
		[martin, sofia] = [await arsUser(), await arsUser()];
		await adminDb.user.update({
			where: { id: martin.user.id },
			data: { language: "de" },
		});
	});

	it("does nothing without a sender, and leaves the outbox alone", async () => {
		const tx = await seedShare(ref(sofia), ref(martin), "100", "ARS");
		const event = await appendOutboxEvent(
			sofia.user.id,
			"shared_expense.created",
			tx.id,
		);
		expect(await runPushWorker({ config: NO_PUSH })).toEqual({
			fannedOut: 0,
			attempted: 0,
		});
		expect(
			(await adminDb.apiEvent.findUniqueOrThrow({ where: { id: event.id } }))
				.pushedAt,
		).toBeNull();
		await adminDb.apiEvent.update({
			where: { id: event.id },
			data: { pushedAt: new Date() },
		});
	});

	it("sends a due delivery in the reader's language and records it", async () => {
		const { device } = await addDevice(martin.user.id, "APNS");
		const delivery = await queue(martin.user.id, device.id);
		const { sent, senders } = recordingSenders();

		expect(await processDuePushes({ config, senders, now: T0 })).toBe(1);

		expect(sent).toHaveLength(1);
		expect(sent[0]?.target.id).toBe(device.id);
		expect(sent[0]?.message.title).toBe("Zahlung erfasst");
		expect(sent[0]?.message.body.replaceAll(" ", " ")).toBe(
			"Eine Zahlung über USD 12,50 wurde erfasst",
		);
		expect(sent[0]?.message.data).toMatchObject({
			type: "payment.recorded",
			entity: { type: "payment", id: "p1" },
		});
		expect(await fresh(delivery.id)).toMatchObject({
			status: "SENT",
			attempts: 1,
			nextAttemptAt: null,
			lastStatusCode: 200,
			lastError: null,
			sentAt: T0,
		});
		// Nothing left to do.
		expect(await processDuePushes({ config, senders, now: T0 })).toBe(0);
	});

	it("measures each lease from its own claim, not from the start of the sweep", async () => {
		const { device } = await addDevice(martin.user.id, "APNS");
		const ids = (
			await Promise.all(
				Array.from({ length: 12 }, () =>
					queue(martin.user.id, device.id, {
						nextAttemptAt: new Date(Date.now() - 1000),
						createdAt: new Date(),
					}),
				),
			)
		).map((d) => d.id);
		// While a chunk is sent, its deliveries are the only pending rows with
		// a lease in the future; read how much of the lease is left.
		const remaining: number[] = [];
		const watching = {
			close() {},
			async send() {
				const rows = await adminDb.pushDelivery.findMany({
					where: { id: { in: ids }, status: "PENDING" },
					select: { nextAttemptAt: true },
				});
				remaining.push(
					Math.max(...rows.map((r) => r.nextAttemptAt?.getTime() ?? 0)) -
						Date.now(),
				);
				await new Promise((r) => setTimeout(r, 250));
				return { kind: "sent" as const, statusCode: 200 };
			},
		};
		await processDuePushes({
			config,
			senders: { ...recordingSenders().senders, APNS: watching },
		});
		expect(remaining).toHaveLength(12);
		// Three chunks of five, 250 ms each: the last claims come half a second
		// after the first. A lease measured from the start of the sweep would
		// be that much shorter by then.
		expect(Math.min(...remaining)).toBeGreaterThan(CLAIM_LEASE_MS - 250);
	});

	it("waits when a delivery is not due yet", async () => {
		const { device } = await addDevice(martin.user.id, "APNS");
		await queue(martin.user.id, device.id, {
			nextAttemptAt: new Date(T0.getTime() + 60_000),
		});
		const { sent, senders } = recordingSenders();
		expect(await processDuePushes({ config, senders, now: T0 })).toBe(0);
		expect(sent).toHaveLength(0);
	});

	describe("retries", () => {
		it("backs off, doubling, then sends when the service recovers", async () => {
			const { device } = await addDevice(martin.user.id, "FCM");
			const delivery = await queue(martin.user.id, device.id);
			let down = true;
			const { sent, senders } = recordingSenders(() =>
				down
					? { kind: "retry", statusCode: 503, code: "http_503" }
					: { kind: "sent", statusCode: 200 },
			);
			const run = (now: Date) => processDuePushes({ config, senders, now });

			await run(T0);
			let row = await fresh(delivery.id);
			expect(row).toMatchObject({
				status: "PENDING",
				attempts: 1,
				lastStatusCode: 503,
				lastError: "http_503",
			});
			expect(row.nextAttemptAt).toEqual(new Date(T0.getTime() + BASE_DELAY_MS));

			// Not before its time.
			expect(await run(new Date(T0.getTime() + BASE_DELAY_MS - 1))).toBe(0);

			const second = new Date(T0.getTime() + BASE_DELAY_MS);
			await run(second);
			row = await fresh(delivery.id);
			expect(row.attempts).toBe(2);
			expect(row.nextAttemptAt).toEqual(
				new Date(second.getTime() + 2 * BASE_DELAY_MS),
			);

			down = false;
			await run(new Date(second.getTime() + 2 * BASE_DELAY_MS));
			row = await fresh(delivery.id);
			expect(row).toMatchObject({
				status: "SENT",
				attempts: 3,
				lastError: null,
			});
			expect(sent.filter((s) => s.target.id === device.id)).toHaveLength(3);
		});

		it("gives up after the last attempt", async () => {
			const { device } = await addDevice(martin.user.id, "APNS");
			const delivery = await queue(martin.user.id, device.id);
			const { senders } = recordingSenders(() => ({
				kind: "retry",
				statusCode: null,
				code: "timeout",
			}));
			let now = T0;
			for (let n = 0; n < MAX_ATTEMPTS; n++) {
				expect(await processDuePushes({ config, senders, now })).toBe(1);
				const row = await fresh(delivery.id);
				if (row.nextAttemptAt) now = row.nextAttemptAt;
			}
			expect(await fresh(delivery.id)).toMatchObject({
				status: "FAILED",
				attempts: MAX_ATTEMPTS,
				nextAttemptAt: null,
				lastError: "timeout",
			});
			expect(await processDuePushes({ config, senders, now })).toBe(0);
		});

		it("believes a Retry-After hint, within the cap", async () => {
			const { device } = await addDevice(martin.user.id, "FCM");
			const delivery = await queue(martin.user.id, device.id);
			let hint = 10 * 60_000;
			const { senders } = recordingSenders(() => ({
				kind: "retry",
				statusCode: 429,
				code: "QUOTA",
				retryAfterMs: hint,
			}));
			await processDuePushes({ config, senders, now: T0 });
			expect((await fresh(delivery.id)).nextAttemptAt).toEqual(
				new Date(T0.getTime() + 10 * 60_000),
			);
			hint = 24 * 3600_000;
			const again = await fresh(delivery.id);
			await processDuePushes({
				config,
				senders,
				now: again.nextAttemptAt as Date,
			});
			expect(
				(await fresh(delivery.id)).nextAttemptAt?.getTime() ?? 0,
			).toBeLessThanOrEqual(
				(again.nextAttemptAt as Date).getTime() + 30 * 60_000,
			);
		});

		it("counts a sender that throws as a failed attempt", async () => {
			const { device } = await addDevice(martin.user.id, "APNS");
			const delivery = await queue(martin.user.id, device.id);
			const senders = recordingSenders().senders;
			senders.APNS = {
				close() {},
				async send() {
					throw new Error("boom");
				},
			};
			await processDuePushes({ config, senders, now: T0 });
			expect(await fresh(delivery.id)).toMatchObject({
				status: "PENDING",
				attempts: 1,
				lastError: "internal_error",
			});
		});
	});

	describe("outcomes that are not retried", () => {
		it("forgets a device whose address is dead, and only that device", async () => {
			const dead = await addDevice(martin.user.id, "APNS");
			const alive = await addDevice(martin.user.id, "APNS");
			const gone = await queue(martin.user.id, dead.device.id);
			const kept = await queue(martin.user.id, alive.device.id);
			const { senders } = recordingSenders((target) =>
				target.id === dead.device.id
					? { kind: "dead", statusCode: 410, code: "Unregistered" }
					: { kind: "sent", statusCode: 200 },
			);

			await processDuePushes({ config, senders, now: T0 });

			expect(
				await adminDb.pushDevice.findUnique({ where: { id: dead.device.id } }),
			).toBeNull();
			expect(
				await adminDb.pushDelivery.findUnique({ where: { id: gone.id } }),
			).toBeNull();
			expect((await fresh(kept.id)).status).toBe("SENT");
			expect(
				await adminDb.pushDevice.findUnique({ where: { id: alive.device.id } }),
			).not.toBeNull();
		});

		it("fails a delivery for good when the service refuses it", async () => {
			const { device } = await addDevice(martin.user.id, "APNS");
			const delivery = await queue(martin.user.id, device.id);
			const { senders } = recordingSenders(() => ({
				kind: "failed",
				statusCode: 400,
				code: "PayloadTooLarge",
			}));
			await processDuePushes({ config, senders, now: T0 });
			expect(await fresh(delivery.id)).toMatchObject({
				status: "FAILED",
				attempts: 1,
				nextAttemptAt: null,
				lastStatusCode: 400,
				lastError: "PayloadTooLarge",
			});
		});

		it("fails what has no sender, a bad payload, and what is too old", async () => {
			const { device } = await addDevice(martin.user.id, "FCM");
			const noSender = await queue(martin.user.id, device.id);
			const { sent, senders } = recordingSenders();
			const { FCM: _fcm, ...withoutFcm } = senders;
			await processDuePushes({ config, senders: withoutFcm, now: T0 });
			expect((await fresh(noSender.id)).lastError).toBe("no_sender");

			const bad = await queue(martin.user.id, device.id, {
				payload: { v: 1, type: "title.leak" },
			});
			const old = await queue(martin.user.id, device.id, {
				createdAt: new Date(T0.getTime() - 25 * 3600_000),
			});
			await processDuePushes({ config, senders, now: T0 });
			expect((await fresh(bad.id)).lastError).toBe("bad_payload");
			expect((await fresh(old.id)).lastError).toBe("expired");
			expect(sent.filter((s) => s.target.id === device.id)).toHaveLength(0);
		});
	});

	describe("every attempt, retries included, re-checks who it is for", () => {
		it("drops a pending retry when the person is no longer active", async () => {
			const leaver = await arsUser();
			const { device } = await addDevice(leaver.user.id, "APNS");
			const delivery = await queue(leaver.user.id, device.id);
			const flaky = recordingSenders(() => ({
				kind: "retry",
				statusCode: 503,
				code: "http_503",
			}));
			await processDuePushes({ config, senders: flaky.senders, now: T0 });
			const waiting = await fresh(delivery.id);
			expect(waiting).toMatchObject({ status: "PENDING", attempts: 1 });

			await adminDb.user.update({
				where: { id: leaver.user.id },
				data: { isActive: false },
			});
			const { sent, senders } = recordingSenders();
			await processDuePushes({
				config,
				senders,
				now: waiting.nextAttemptAt as Date,
			});

			expect(sent).toHaveLength(0);
			expect(await fresh(delivery.id)).toMatchObject({
				status: "FAILED",
				nextAttemptAt: null,
				lastError: "user_inactive",
			});
		});

		it("sends to the device as it is now, not as it was when queued", async () => {
			const { device } = await addDevice(martin.user.id, "APNS");
			const delivery = await queue(martin.user.id, device.id);
			const flaky = recordingSenders(() => ({
				kind: "retry",
				statusCode: 503,
				code: "http_503",
			}));
			await processDuePushes({ config, senders: flaky.senders, now: T0 });
			const waiting = await fresh(delivery.id);

			// The app registered a new token for the same device row.
			await adminDb.pushDevice.update({
				where: { id: device.id },
				data: { token: "ab".repeat(32) },
			});
			const { sent, senders } = recordingSenders();
			await processDuePushes({
				config,
				senders,
				now: waiting.nextAttemptAt as Date,
			});
			expect(sent.map((s) => s.target.token)).toEqual(["ab".repeat(32)]);
			expect((await fresh(delivery.id)).status).toBe("SENT");
		});

		it("drops a retry when someone else has since registered the same address", async () => {
			const address = randomUUID().replaceAll("-", "").repeat(2);
			const first = await addDevice(martin.user.id, "APNS", { address });
			const delivery = await queue(martin.user.id, first.device.id);
			const flaky = recordingSenders(() => ({
				kind: "retry",
				statusCode: 503,
				code: "http_503",
			}));
			await processDuePushes({ config, senders: flaky.senders, now: T0 });
			const waiting = await fresh(delivery.id);

			// The phone changed hands: the new account used the address last.
			await addDevice(sofia.user.id, "APNS", {
				address,
				lastSeenAt: new Date(T0.getTime() + 1000),
			});
			const { sent, senders } = recordingSenders();
			await processDuePushes({
				config,
				senders,
				now: waiting.nextAttemptAt as Date,
			});

			expect(sent).toHaveLength(0);
			expect(await fresh(delivery.id)).toMatchObject({
				status: "FAILED",
				lastError: "device_unusable",
			});
		});

		it("drops a retry when the session behind the device has expired", async () => {
			const { device } = await addDevice(martin.user.id, "APNS");
			const session = await adminDb.session.create({
				data: {
					id: randomUUID(),
					token: randomUUID(),
					userId: martin.user.id,
					expiresAt: new Date(T0.getTime() + 60_000),
				},
			});
			await adminDb.pushDevice.update({
				where: { id: device.id },
				data: { sessionId: session.id },
			});
			const delivery = await queue(martin.user.id, device.id, {
				nextAttemptAt: new Date(T0.getTime() + 120_000),
			});
			const { sent, senders } = recordingSenders();
			await processDuePushes({
				config,
				senders,
				now: new Date(T0.getTime() + 120_000),
			});
			expect(sent).toHaveLength(0);
			expect((await fresh(delivery.id)).lastError).toBe("device_unusable");
		});

		it("drops a retry when the type was switched off in the meantime", async () => {
			const { device } = await addDevice(martin.user.id, "APNS");
			// queue() makes a payment.recorded push: SETTLEMENT_RECEIVED.
			const delivery = await queue(martin.user.id, device.id);
			await adminDb.notificationPreference.upsert({
				where: {
					userId_type: { userId: martin.user.id, type: "SETTLEMENT_RECEIVED" },
				},
				create: {
					userId: martin.user.id,
					type: "SETTLEMENT_RECEIVED",
					push: false,
				},
				update: { push: false },
			});
			const { sent, senders } = recordingSenders();
			await processDuePushes({ config, senders, now: T0 });
			expect(sent).toHaveLength(0);
			expect(await fresh(delivery.id)).toMatchObject({
				status: "FAILED",
				lastError: "push_off",
			});
			await adminDb.notificationPreference.update({
				where: {
					userId_type: { userId: martin.user.id, type: "SETTLEMENT_RECEIVED" },
				},
				data: { push: true },
			});
		});

		it("does not send for a device that was deleted, and takes its deliveries along", async () => {
			const { device } = await addDevice(martin.user.id, "APNS");
			const delivery = await queue(martin.user.id, device.id);
			await adminDb.pushDevice.delete({ where: { id: device.id } });
			const { sent, senders } = recordingSenders();
			expect(await processDuePushes({ config, senders, now: T0 })).toBe(0);
			expect(sent).toHaveLength(0);
			expect(
				await adminDb.pushDelivery.findUnique({ where: { id: delivery.id } }),
			).toBeNull();
		});
	});

	it("sends a delivery once when two workers race for it", async () => {
		const { device } = await addDevice(martin.user.id, "APNS");
		const delivery = await queue(martin.user.id, device.id);
		const { sent, senders } = recordingSenders();
		const results = await Promise.all([
			processDuePushes({ config, senders, now: T0 }),
			processDuePushes({ config, senders, now: T0 }),
		]);
		expect(results.reduce((a, b) => a + b, 0)).toBe(1);
		expect(sent.filter((s) => s.target.id === device.id)).toHaveLength(1);
		expect((await fresh(delivery.id)).attempts).toBe(1);
	});

	describe("recurring items", () => {
		let person: TestUser;
		const NOW = new Date("2026-10-26T15:00:00Z");
		beforeAll(async () => {
			person = await arsUser();
			await adminDb.user.update({
				where: { id: person.user.id },
				data: { timeZone: "UTC" },
			});
			await addDevice(person.user.id, "APNS");
		});

		const template = (over: Record<string, unknown>) =>
			adminDb.recurringTemplate.create({
				data: {
					userId: person.user.id,
					name: "Netflix, a very private name",
					amount: "15.5",
					currency: "USD",
					frequency: "MONTHLY",
					nextDueDate: new Date("2026-10-26T00:00:00Z"),
					autoPay: false,
					...over,
				},
			});

		it("pushes each due date once, with the amount when it is fixed", async () => {
			const fixed = await template({});
			const asked = await template({ amountMode: "ASK" });
			await template({ nextDueDate: new Date("2026-11-30T00:00:00Z") });
			await template({ nextDueDate: new Date("2026-09-01T00:00:00Z") });
			await template({ isActive: false });
			// The sidecar posts this one itself within the hour.
			await template({
				autoPay: true,
				nextDueDate: new Date("2026-10-26T14:30:00Z"),
			});
			const income = await template({ direction: "IN", amount: "2000" });

			expect(await raiseRecurringDue(config, NOW)).toBe(3);
			expect(await raiseRecurringDue(config, NOW)).toBe(0);

			const rows = await deliveriesOf(person.user.id);
			expect(rows.map((d) => d.eventType)).toEqual([
				"recurring.due",
				"recurring.due",
				"recurring.due",
			]);
			const byEntity = Object.fromEntries(
				rows.map((d) => [
					(d.payload as { entity: { id: string } }).entity.id,
					d,
				]),
			);
			expect(byEntity[fixed.id]).toMatchObject({
				channel: "recurring",
				dedupeKey: `recurring:${fixed.id}:2026-10-26`,
				payload: {
					amount: { minor: 1550, currency: "USD" },
					direction: "out",
				},
			});
			expect(byEntity[asked.id]?.payload).toMatchObject({ amount: null });
			expect(byEntity[income.id]?.payload).toMatchObject({ direction: "in" });
			expect(JSON.stringify(rows)).not.toContain("Netflix");
		});

		it("pushes again for the next due date", async () => {
			const before = (await deliveriesOf(person.user.id)).length;
			await adminDb.recurringTemplate.updateMany({
				where: {
					userId: person.user.id,
					nextDueDate: new Date("2026-10-26T00:00:00Z"),
				},
				data: { nextDueDate: new Date("2026-10-27T00:00:00Z") },
			});
			expect(
				await raiseRecurringDue(config, new Date("2026-10-27T15:00:00Z")),
			).toBeGreaterThanOrEqual(3);
			expect((await deliveriesOf(person.user.id)).length).toBeGreaterThan(
				before,
			);
		});
	});

	it("deletes finished deliveries past retention, and keeps pending ones", async () => {
		const { device } = await addDevice(sofia.user.id, "APNS");
		const old = new Date(T0.getTime() - 8 * 86_400_000);
		const done = await queue(sofia.user.id, device.id, { createdAt: old });
		await adminDb.pushDelivery.update({
			where: { id: done.id },
			data: { status: "SENT" },
		});
		const pending = await queue(sofia.user.id, device.id, { createdAt: old });
		const recent = await queue(sofia.user.id, device.id);
		await adminDb.pushDelivery.update({
			where: { id: recent.id },
			data: { status: "SENT" },
		});
		await prunePushData(T0);
		expect(
			await adminDb.pushDelivery.findUnique({ where: { id: done.id } }),
		).toBeNull();
		for (const id of [pending.id, recent.id])
			expect(
				await adminDb.pushDelivery.findUnique({ where: { id } }),
			).not.toBeNull();
	});

	describe("end to end through the real senders", () => {
		let closeServer: (() => Promise<void>) | undefined;
		afterEach(async () => {
			await closeServer?.();
			closeServer = undefined;
		});

		it("delivers a shared expense to an Android phone as an encrypted Web Push", async () => {
			const [payer, friend] = [await arsUser(), await arsUser()];
			await adminDb.user.update({
				where: { id: friend.user.id },
				data: { language: "es-AR" },
			});
			const dinner = await seedShare(ref(payer), ref(friend), "9000", "ARS", {
				title: "Cena en Chez Nous 7421",
			});
			const server = await mockHttp(() => ({ status: 201 }));
			closeServer = server.close;
			const phone = await addDevice(friend.user.id, "UNIFIEDPUSH", {
				address: `${server.url}/up/phone-1`,
			});
			await appendOutboxEvent(
				payer.user.id,
				"shared_expense.created",
				dinner.id,
			);

			const real = loadPushConfig({
				...newVapidEnv(),
				PUSH_ENDPOINT_ALLOW_HOSTS: "127.0.0.1",
			});
			await sweepUntilPushed(() => runPushWorker({ config: real }));

			expect(server.seen).toHaveLength(1);
			const body = JSON.parse(
				decryptWebPush(server.seen[0]?.body ?? Buffer.alloc(0), {
					...phone.subscription,
					privateKey: phone.subscription.privateKey,
				}).toString(),
			);
			expect(body).toMatchObject({
				title: "Nuevo gasto compartido",
				type: "shared_expense.created",
				channel: "splits",
				entity: { type: "shared_expense", id: dinner.id },
				amount: { minor: 900000, currency: "ARS" },
			});
			expect(body.body.replaceAll(" ", " ")).toBe("Tu parte es ARS 9.000");
			expect(JSON.stringify(body)).not.toContain("Chez");
			expect((await deliveriesOf(friend.user.id))[0]?.status).toBe("SENT");
			expect(await deliveriesOf(payer.user.id)).toHaveLength(0);
		});

		it("refuses to push to a private address that nobody allowed", async () => {
			const [payer, friend] = [await arsUser(), await arsUser()];
			const dinner = await seedShare(ref(payer), ref(friend), "500", "ARS");
			const server = await mockHttp(() => ({ status: 201 }));
			closeServer = server.close;
			await addDevice(friend.user.id, "UNIFIEDPUSH", {
				address: `${server.url}/up/phone-2`,
			});
			await appendOutboxEvent(
				payer.user.id,
				"shared_expense.created",
				dinner.id,
			);

			await sweepUntilPushed(() =>
				runPushWorker({
					config: loadPushConfig({ ...newVapidEnv() }),
					allowPrivate: false,
				}),
			);

			expect(server.seen).toHaveLength(0);
			expect((await deliveriesOf(friend.user.id))[0]).toMatchObject({
				status: "FAILED",
				lastError: "blocked_target",
			});
		});
	});

	it("tells apps which transports the server can use", async () => {
		const none = await getServerInfo(NO_PUSH);
		expect(none.push).toEqual({ transports: [] });
		const vapid = newVapidEnv();
		const all = await getServerInfo(allSendersConfig(vapid));
		expect(all.push).toEqual({
			transports: ["apns", "fcm", "unifiedpush"],
			vapidPublicKey: vapid.VAPID_PUBLIC_KEY,
		});
	});
});
