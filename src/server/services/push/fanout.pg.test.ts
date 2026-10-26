/**
 * The push fan-out on Postgres: who an outbox event reaches, what their
 * preferences allow and which devices get a delivery. Fixture: Sofia pays
 * for dinner that Martin owes in full (ARS 1,000), and Lucia is on the
 * split with a share of ARS 250.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
	arsUser,
	ref,
	seedShare,
	type TestUser,
} from "~/server/api/v1/__tests__/g3-fixtures";
import {
	enqueuePushes,
	MAX_PUSHES_PER_USER_PER_HOUR,
	type PushDraft,
} from "./enqueue";
import { fanOutPushEvents } from "./fanout";
import { newPushData } from "./message";
import {
	addDevice,
	adminDb,
	allSendersConfig,
	appendOutboxEvent,
	deliveriesOf,
	sweepUntilPushed,
} from "./pg-fixtures";

const TITLE = "Secret dinner at Chez Nous 7421";
const config = allSendersConfig();

describe("push fan-out", () => {
	let sofia: TestUser;
	let martin: TestUser;
	let lucia: TestUser;
	let stranger: TestUser;
	let split: string;

	beforeAll(async () => {
		[sofia, martin, lucia, stranger] = [
			await arsUser(),
			await arsUser(),
			await arsUser(),
			await arsUser(),
		];
		const tx = await seedShare(ref(sofia), ref(martin), "1000", "ARS", {
			title: TITLE,
		});
		await adminDb.splitParticipant.create({
			data: {
				transactionId: tx.id,
				...ref(lucia),
				shareAmount: "250",
				verificationStatus: "ACCEPTED",
			},
		});
		split = tx.id;
		for (const u of [sofia, martin, lucia, stranger])
			await addDevice(u.user.id, "APNS");
	});

	const fanOut = (now = new Date()) =>
		sweepUntilPushed(() => fanOutPushEvents(config, now));

	it("tells the other people on a shared expense, each with their share, and never the actor", async () => {
		await appendOutboxEvent(sofia.user.id, "shared_expense.created", split);
		await fanOut();

		const [forMartin, forLucia] = await Promise.all([
			deliveriesOf(martin.user.id),
			deliveriesOf(lucia.user.id),
		]);
		expect(forMartin).toHaveLength(1);
		expect(forLucia).toHaveLength(1);
		expect(await deliveriesOf(sofia.user.id)).toHaveLength(0);
		expect(await deliveriesOf(stranger.user.id)).toHaveLength(0);

		expect(forMartin[0]).toMatchObject({
			eventType: "shared_expense.created",
			channel: "splits",
			status: "PENDING",
			attempts: 0,
		});
		expect(forMartin[0]?.payload).toEqual({
			v: 1,
			type: "shared_expense.created",
			channel: "splits",
			entity: { type: "shared_expense", id: split },
			ids: {},
			amount: { minor: 100000, currency: "ARS" },
		});
		expect(forLucia[0]?.payload).toMatchObject({
			amount: { minor: 25000, currency: "ARS" },
		});
		// Ids and an amount only: nothing a person typed.
		expect(JSON.stringify([forMartin, forLucia])).not.toContain(TITLE);
		expect(JSON.stringify([forMartin, forLucia])).not.toContain("Chez");
	});

	describe("a person who joined after being added by name", () => {
		let owner: TestUser;
		let joined: TestUser;
		let unclaimed: TestUser;
		let expense: string;
		beforeAll(async () => {
			[owner, joined, unclaimed] = [
				await arsUser(),
				await arsUser(),
				await arsUser(),
			];
			for (const u of [owner, joined, unclaimed])
				await addDevice(u.user.id, "APNS");
			const claimed = await adminDb.shadowProfile.create({
				data: {
					createdById: owner.user.id,
					name: "Sam",
					claimedById: joined.user.id,
					claimedAt: new Date(),
				},
			});
			const open = await adminDb.shadowProfile.create({
				data: { createdById: owner.user.id, name: "Pat" },
			});
			const tx = await seedShare(
				ref(owner),
				{ participantType: "shadow", participantId: claimed.id },
				"600",
				"ARS",
			);
			await adminDb.splitParticipant.create({
				data: {
					transactionId: tx.id,
					participantType: "shadow",
					participantId: open.id,
					shareAmount: "100",
					verificationStatus: "ACCEPTED",
				},
			});
			expense = tx.id;
		});

		it("follows a claimed profile to its account, and tells nobody for an unclaimed one", async () => {
			await appendOutboxEvent(owner.user.id, "shared_expense.created", expense);
			await fanOut();
			const told = await deliveriesOf(joined.user.id);
			expect(told).toHaveLength(1);
			expect(told[0]?.payload).toMatchObject({
				entity: { type: "shared_expense", id: expense },
				amount: { minor: 60000, currency: "ARS" },
			});
			expect(await deliveriesOf(unclaimed.user.id)).toHaveLength(0);
		});

		it("lets the account act on the profile's expense: an event by it reaches the owner", async () => {
			const before = (await deliveriesOf(owner.user.id)).length;
			await appendOutboxEvent(joined.user.id, "shared_expense.updated", expense);
			await fanOut();
			expect((await deliveriesOf(owner.user.id)).length).toBe(before + 1);
		});
	});

	it("looks at an event once", async () => {
		const event = await appendOutboxEvent(
			sofia.user.id,
			"shared_expense.updated",
			split,
		);
		const before = (await deliveriesOf(martin.user.id)).length;
		await fanOut();
		expect(await fanOutPushEvents(config)).toBe(0);
		expect((await deliveriesOf(martin.user.id)).length).toBe(before + 1);
		expect(
			(await adminDb.apiEvent.findUniqueOrThrow({ where: { id: event.id } }))
				.pushedAt,
		).not.toBeNull();
	});

	it("skips what has no push, what is stale and what is gone", async () => {
		const quiet = await appendOutboxEvent(
			sofia.user.id,
			"expense.created",
			split,
		);
		const old = await appendOutboxEvent(
			sofia.user.id,
			"shared_expense.created",
			split,
			{ createdAt: new Date(Date.now() - 2 * 3600_000) },
		);
		const gone = await appendOutboxEvent(
			sofia.user.id,
			"shared_expense.created",
			"deleted-since",
		);
		const before = await adminDb.pushDelivery.count();
		await fanOut();
		expect(await adminDb.pushDelivery.count()).toBe(before);
		for (const e of [quiet, old, gone])
			expect(
				(await adminDb.apiEvent.findUniqueOrThrow({ where: { id: e.id } }))
					.pushedAt,
			).not.toBeNull();
	});

	it("ignores an event whose actor has no part in the entity", async () => {
		await appendOutboxEvent(stranger.user.id, "shared_expense.updated", split);
		const before = await adminDb.pushDelivery.count();
		await fanOut();
		expect(await adminDb.pushDelivery.count()).toBe(before);
	});

	it("honors the person's notification preferences", async () => {
		await adminDb.notificationPreference.create({
			data: {
				userId: martin.user.id,
				type: "EXPENSE_EDITED",
				push: false,
				email: false,
				digestMode: false,
			},
		});
		const martinBefore = (await deliveriesOf(martin.user.id)).length;
		const luciaBefore = (await deliveriesOf(lucia.user.id)).length;
		await appendOutboxEvent(sofia.user.id, "shared_expense.updated", split);
		await fanOut();
		expect((await deliveriesOf(martin.user.id)).length).toBe(martinBefore);
		expect((await deliveriesOf(lucia.user.id)).length).toBe(luciaBefore + 1);
		// Other types of the same person are untouched.
		await appendOutboxEvent(sofia.user.id, "shared_expense.created", split);
		await fanOut();
		expect((await deliveriesOf(martin.user.id)).length).toBe(martinBefore + 1);
	});

	it("follows the push switch, not the in-app one", async () => {
		await adminDb.notificationPreference.create({
			data: {
				userId: lucia.user.id,
				type: "VERIFICATION_REQUEST",
				inApp: false,
				push: true,
			},
		});
		await adminDb.notificationPreference.create({
			data: {
				userId: stranger.user.id,
				type: "VERIFICATION_REQUEST",
				inApp: true,
				push: false,
			},
		});
		const drafts = (userId: string): PushDraft => ({
			userId,
			eventId: null,
			dedupeKey: `follows-the-push-switch:${userId}`,
			data: newPushData("fix_request.created", {
				entity: { type: "fix_request", id: "f1" },
			}),
		});
		const mine = [lucia, stranger].map((u) => drafts(u.user.id));
		await adminDb.$transaction((tx) =>
			enqueuePushes(tx, config, mine, new Date()),
		);
		expect(
			(await deliveriesOf(lucia.user.id)).filter((d) =>
				d.dedupeKey.startsWith("follows-the-push-switch"),
			),
		).toHaveLength(1);
		expect(
			(await deliveriesOf(stranger.user.id)).filter((d) =>
				d.dedupeKey.startsWith("follows-the-push-switch"),
			),
		).toHaveLength(0);
	});

	it("lets a person turn off recurring reminders", async () => {
		const quiet = await arsUser();
		const loud = await arsUser();
		for (const u of [quiet, loud]) await addDevice(u.user.id, "APNS");
		await adminDb.notificationPreference.create({
			data: { userId: quiet.user.id, type: "RECURRING_DUE", push: false },
		});
		const draft = (userId: string): PushDraft => ({
			userId,
			eventId: null,
			dedupeKey: `recurring:r1:2026-10-26`,
			data: newPushData("recurring.due", {
				entity: { type: "recurring", id: "r1" },
			}),
		});
		await adminDb.$transaction((tx) =>
			enqueuePushes(
				tx,
				config,
				[quiet, loud].map((u) => draft(u.user.id)),
				new Date(),
			),
		);
		expect(await deliveriesOf(quiet.user.id)).toHaveLength(0);
		expect(await deliveriesOf(loud.user.id)).toHaveLength(1);
	});

	describe("payments", () => {
		let payment: string;
		beforeAll(async () => {
			payment = randomUUID();
			await adminDb.payment.create({
				data: {
					id: payment,
					payerType: "user",
					payerId: sofia.user.id,
					payeeType: "user",
					payeeId: martin.user.id,
					amount: "400",
					currency: "ARS",
					paidOn: new Date("2026-10-10"),
					recordedByType: "user",
					recordedById: sofia.user.id,
				},
			});
		});

		it("tells the other party of a recorded payment, with its amount", async () => {
			const before = await deliveriesOf(martin.user.id);
			await appendOutboxEvent(sofia.user.id, "payment.recorded", payment);
			await fanOut();
			const after = await deliveriesOf(martin.user.id);
			const fresh = after.filter((d) => !before.some((b) => b.id === d.id));
			expect(fresh).toHaveLength(1);
			expect(fresh[0]).toMatchObject({
				eventType: "payment.recorded",
				channel: "payments",
				payload: {
					entity: { type: "payment", id: payment },
					amount: { minor: 40000, currency: "ARS" },
				},
			});
		});

		it("tells the payer when the payee confirms, or says it was not received", async () => {
			const before = (await deliveriesOf(sofia.user.id)).length;
			await appendOutboxEvent(martin.user.id, "payment.confirmed", payment);
			await appendOutboxEvent(martin.user.id, "payment.not_received", payment);
			await fanOut();
			const after = await deliveriesOf(sofia.user.id);
			expect(after.slice(before).map((d) => [d.eventType, d.channel])).toEqual([
				["payment.confirmed", "payments"],
				["payment.not_received", "payments"],
			]);
		});

		it("puts a reminder on the reminders channel", async () => {
			const before = (await deliveriesOf(martin.user.id)).length;
			await appendOutboxEvent(sofia.user.id, "payment.reminded", payment);
			await fanOut();
			const latest = (await deliveriesOf(martin.user.id)).slice(before);
			expect(latest).toHaveLength(1);
			expect(latest[0]).toMatchObject({
				eventType: "payment.reminded",
				channel: "reminders",
			});
		});

		it("does not push a payment the actor is not part of", async () => {
			const before = await adminDb.pushDelivery.count();
			await appendOutboxEvent(stranger.user.id, "payment.recorded", payment);
			await fanOut();
			expect(await adminDb.pushDelivery.count()).toBe(before);
		});
	});

	it("tells the person asked to fix an expense, with the expense id", async () => {
		const request = randomUUID();
		await adminDb.fixRequest.create({
			data: {
				id: request,
				transactionId: split,
				requestedByType: "user",
				requestedById: martin.user.id,
				askedType: "user",
				askedId: sofia.user.id,
				message: "The total is wrong, it was Chez Nous",
			},
		});
		const before = (await deliveriesOf(sofia.user.id)).length;
		await appendOutboxEvent(martin.user.id, "fix_request.created", request);
		await fanOut();
		const fresh = (await deliveriesOf(sofia.user.id)).slice(before);
		expect(fresh).toHaveLength(1);
		expect(fresh[0]).toMatchObject({
			channel: "splits",
			payload: {
				entity: { type: "fix_request", id: request },
				ids: { transactionId: split },
				amount: null,
			},
		});
		expect(JSON.stringify(fresh)).not.toContain("Chez Nous");
	});

	describe("devices", () => {
		it("makes one delivery per device, only on transports that have a sender", async () => {
			const person = await arsUser();
			const [apns, fcm, up] = await Promise.all([
				addDevice(person.user.id, "APNS"),
				addDevice(person.user.id, "FCM"),
				addDevice(person.user.id, "UNIFIEDPUSH"),
			]);
			const drafts: PushDraft[] = [
				{
					userId: person.user.id,
					eventId: null,
					dedupeKey: "k-all",
					data: newPushData("payment.recorded"),
				},
			];
			const onlyApns = { ...config, fcm: undefined, webPush: undefined };
			await adminDb.$transaction((tx) =>
				enqueuePushes(tx, onlyApns, drafts, new Date()),
			);
			expect(
				(await deliveriesOf(person.user.id)).map((d) => d.deviceId),
			).toEqual([apns.device.id]);

			await adminDb.$transaction((tx) =>
				enqueuePushes(
					tx,
					config,
					[{ ...drafts[0], dedupeKey: "k-2" } as PushDraft],
					new Date(),
				),
			);
			const devices = (await deliveriesOf(person.user.id))
				.filter((d) => d.dedupeKey === "k-2")
				.map((d) => d.deviceId)
				.sort();
			expect(devices).toEqual(
				[apns.device.id, fcm.device.id, up.device.id].sort(),
			);
		});

		it("sends to the account that used a shared address last", async () => {
			const [first, second] = [await arsUser(), await arsUser()];
			const address = `shared-${randomUUID().replaceAll("-", "")}-token`;
			await addDevice(first.user.id, "APNS", {
				address,
				lastSeenAt: new Date(Date.now() - 86_400_000),
			});
			const newest = await addDevice(second.user.id, "APNS", { address });
			const draft = (userId: string): PushDraft => ({
				userId,
				eventId: null,
				dedupeKey: "shared-address",
				data: newPushData("payment.recorded"),
			});
			await adminDb.$transaction((tx) =>
				enqueuePushes(
					tx,
					config,
					[draft(first.user.id), draft(second.user.id)],
					new Date(),
				),
			);
			expect(await deliveriesOf(first.user.id)).toHaveLength(0);
			expect(
				(await deliveriesOf(second.user.id)).map((d) => d.deviceId),
			).toEqual([newest.device.id]);
		});

		it("skips devices whose session or key lapsed and users who are not active", async () => {
			const person = await arsUser();
			const draft: PushDraft = {
				userId: person.user.id,
				eventId: null,
				dedupeKey: "lapsed",
				data: newPushData("payment.recorded"),
			};
			const session = (expiresAt: Date) =>
				adminDb.session.create({
					data: {
						id: randomUUID(),
						token: randomUUID(),
						userId: person.user.id,
						expiresAt,
					},
				});
			const key = (over: { enabled?: boolean; expiresAt?: Date | null }) =>
				adminDb.apikey.create({
					data: {
						id: randomUUID(),
						referenceId: person.user.id,
						key: randomUUID(),
						createdAt: new Date(),
						updatedAt: new Date(),
						...over,
					},
				});
			const withCredential = async (credential: object) => {
				const { device } = await addDevice(person.user.id, "APNS");
				return adminDb.pushDevice.update({
					where: { id: device.id },
					data: credential,
				});
			};
			const live = await withCredential({
				sessionId: (await session(new Date(Date.now() + 86_400_000))).id,
			});
			await withCredential({
				sessionId: (await session(new Date(Date.now() - 1000))).id,
			});
			const liveKey = await withCredential({
				apiKeyId: (await key({ expiresAt: null })).id,
			});
			await withCredential({
				apiKeyId: (await key({ enabled: false })).id,
			});
			await withCredential({
				apiKeyId: (await key({ expiresAt: new Date(Date.now() - 1000) })).id,
			});
			const run = () =>
				adminDb.$transaction((tx) =>
					enqueuePushes(tx, config, [draft], new Date()),
				);

			await run();
			expect(
				(await deliveriesOf(person.user.id)).map((d) => d.deviceId).sort(),
			).toEqual([live.id, liveKey.id].sort());

			await adminDb.user.update({
				where: { id: person.user.id },
				data: { isActive: false },
			});
			await adminDb.pushDelivery.deleteMany({
				where: { userId: person.user.id },
			});
			expect(await run()).toBe(0);
		});

		it("never makes the same delivery twice", async () => {
			const person = await arsUser();
			await addDevice(person.user.id, "APNS");
			const draft: PushDraft = {
				userId: person.user.id,
				eventId: null,
				dedupeKey: "same-thing",
				data: newPushData("recurring.due"),
			};
			const run = () =>
				adminDb.$transaction((tx) =>
					enqueuePushes(tx, config, [draft], new Date()),
				);
			expect(await run()).toBe(1);
			expect(await run()).toBe(0);
			expect(await deliveriesOf(person.user.id)).toHaveLength(1);
		});
	});

	it("caps how many different pushes one person gets in an hour", async () => {
		const person = await arsUser();
		await addDevice(person.user.id, "APNS");
		const drafts = Array.from(
			{ length: MAX_PUSHES_PER_USER_PER_HOUR + 5 },
			(_, i): PushDraft => ({
				userId: person.user.id,
				eventId: null,
				dedupeKey: `flood-${i}`,
				data: newPushData("payment.recorded"),
			}),
		);
		const now = new Date();
		await adminDb.$transaction((tx) => enqueuePushes(tx, config, drafts, now));
		expect(await deliveriesOf(person.user.id)).toHaveLength(
			MAX_PUSHES_PER_USER_PER_HOUR,
		);
		// The cap counts what is already queued, so a later batch adds none.
		await adminDb.$transaction((tx) =>
			enqueuePushes(
				tx,
				config,
				[{ ...(drafts[0] as PushDraft), dedupeKey: "one-more" }],
				now,
			),
		);
		expect(await deliveriesOf(person.user.id)).toHaveLength(
			MAX_PUSHES_PER_USER_PER_HOUR,
		);
		// An hour later the person is under the cap again.
		await adminDb.$transaction((tx) =>
			enqueuePushes(
				tx,
				config,
				[{ ...(drafts[0] as PushDraft), dedupeKey: "next-hour" }],
				new Date(now.getTime() + 61 * 60_000),
			),
		);
		expect(await deliveriesOf(person.user.id)).toHaveLength(
			MAX_PUSHES_PER_USER_PER_HOUR + 1,
		);
	});

	it("does nothing for people who are not users", async () => {
		const shadow = await adminDb.shadowProfile.create({
			data: { createdById: sofia.user.id, name: "Cousin Vinny" },
		});
		const tx = await seedShare(
			ref(sofia),
			{ participantType: "shadow", participantId: shadow.id },
			"300",
			"ARS",
		);
		const before = await adminDb.pushDelivery.count();
		await appendOutboxEvent(sofia.user.id, "shared_expense.created", tx.id);
		await fanOut();
		expect(await adminDb.pushDelivery.count()).toBe(before);
	});
});
