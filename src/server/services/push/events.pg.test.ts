/**
 * The push fan-out against the events the real v1 writes leave: the entity
 * an event names is what the recipient lookup reads, so this runs the routes
 * and checks who gets a push for each. Fixture (ARS home, one project):
 * Martin paid ARS 18,000 that Sofia owes.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	arsUser,
	ref,
	seedProject,
	seedRates,
	seedShare,
	type TestUser,
} from "~/server/api/v1/__tests__/g3-fixtures";
import { asMobile, call } from "~/server/api/v1/core/__tests__/harness";
import {
	addDevice,
	adminDb,
	allSendersConfig,
	recordingSenders,
	sweepUntilPushed,
} from "./pg-fixtures";
import { runPushWorker } from "./worker";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const config = allSendersConfig();
const TITLE = "Dinner at Chez Nous 7421";

describe("push for real v1 writes", () => {
	let sofia: TestUser;
	let martin: TestUser;
	let asSofia: Record<string, string>;
	let asMartin: Record<string, string>;
	let split: string;
	let sofiaDevice: string;
	let martinDevice: string;

	const post = (path: string, body: unknown, headers: Record<string, string>) =>
		call(path, { method: "POST", headers, body, idempotent: true });

	/** What each person's phone received in one sweep. */
	async function sweep() {
		const { sent, senders } = recordingSenders();
		await sweepUntilPushed(() => runPushWorker({ config, senders }));
		const to = (deviceId: string) =>
			sent.filter((s) => s.target.id === deviceId).map((s) => s.message);
		return { sofia: to(sofiaDevice), martin: to(martinDevice) };
	}

	beforeAll(async () => {
		await seedRates();
		[sofia, martin] = [await arsUser(), await arsUser()];
		[asSofia, asMartin] = [
			await asMobile(sofia.user.id),
			await asMobile(martin.user.id),
		];
		sofiaDevice = (await addDevice(sofia.user.id, "APNS")).device.id;
		martinDevice = (await addDevice(martin.user.id, "FCM")).device.id;
		const trip = await seedProject(martin, [{ user: sofia, role: "EDITOR" }]);
		split = (
			await seedShare(ref(martin), ref(sofia), "18000", "ARS", {
				projectId: trip,
				title: TITLE,
			})
		).id;
		await sweep();
	});

	it("tells the other person when a shared expense is added and changed", async () => {
		const body = {
			amount: "9000",
			currency: "ARS",
			description: TITLE,
			date: "2026-10-10",
			paidBy: { type: "user", id: sofia.user.id },
			splitWith: [
				{ type: "user", id: sofia.user.id },
				{ type: "user", id: martin.user.id },
			],
			splitMode: "EQUAL",
		};
		const created = await post("/shared-expenses", body, asSofia);
		expect(created.status).toBe(201);
		const { id } = (await created.json()) as { id: string };

		let got = await sweep();
		expect(got.sofia).toEqual([]);
		expect(got.martin).toHaveLength(1);
		expect(got.martin[0]).toMatchObject({
			title: "New shared expense",
			channel: "splits",
			data: {
				type: "shared_expense.created",
				entity: { type: "shared_expense", id },
				amount: { minor: 450000, currency: "ARS" },
			},
		});

		const changed = await call(`/shared-expenses/${id}`, {
			method: "PUT",
			headers: asSofia,
			body: { ...body, amount: "12000" },
			idempotent: true,
		});
		expect(changed.status).toBe(200);
		got = await sweep();
		expect(got.martin).toHaveLength(1);
		expect(got.martin[0]).toMatchObject({
			title: "Shared expense changed",
			data: { amount: { minor: 600000, currency: "ARS" } },
		});
		expect(JSON.stringify(got)).not.toContain("Chez");
	});

	it("follows a payment from recorded, to reminded, to confirmed", async () => {
		const recorded = await post(
			"/payments",
			{
				person: { type: "user", id: martin.user.id },
				direction: "outgoing",
				currency: "ARS",
				amount: "5000",
			},
			asSofia,
		);
		expect(recorded.status).toBe(201);
		const { id } = (await recorded.json()) as { id: string };

		let got = await sweep();
		expect(got.sofia).toEqual([]);
		expect(got.martin).toHaveLength(1);
		expect(got.martin[0]).toMatchObject({
			title: "Payment recorded",
			channel: "payments",
			data: {
				entity: { type: "payment", id },
				amount: { minor: 500000, currency: "ARS" },
			},
		});

		expect((await post(`/payments/${id}/remind`, {}, asSofia)).status).toBe(
			200,
		);
		got = await sweep();
		expect(got.martin).toHaveLength(1);
		expect(got.martin[0]).toMatchObject({
			title: "Payment reminder",
			channel: "reminders",
		});
		expect(got.sofia).toEqual([]);

		expect(
			(await post(`/payments/${id}/confirm`, { id }, asMartin)).status,
		).toBe(200);
		got = await sweep();
		expect(got.sofia).toHaveLength(1);
		expect(got.sofia[0]).toMatchObject({
			title: "Payment confirmed",
			data: { amount: { minor: 500000, currency: "ARS" } },
		});
		expect(got.martin).toEqual([]);
	});

	it("tells the person asked to fix an expense", async () => {
		await adminDb.sharedTransaction.update({
			where: { id: split },
			data: { isLocked: true },
		});
		const requestId = randomUUID();
		const asked = await post(
			`/shared-expenses/${split}/fix-requests`,
			{ requestId, message: "Wrong total, it was the Chez Nous place" },
			asSofia,
		);
		expect(asked.status).toBe(201);
		const got = await sweep();
		expect(got.martin).toHaveLength(1);
		expect(got.martin[0]).toMatchObject({
			title: "Fix requested",
			data: {
				entity: { type: "fix_request", id: requestId },
				ids: { transactionId: split },
			},
		});
		expect(got.sofia).toEqual([]);
		expect(JSON.stringify(got)).not.toContain("Chez");
	});
});
