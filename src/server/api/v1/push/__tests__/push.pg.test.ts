/**
 * /api/v1/push-devices on Postgres (M12): APNs, FCM and UnifiedPush
 * registrations, refresh instead of duplicate, no secret ever echoed, the
 * table's own address check, replays and RLS between users.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	adminDb,
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
	useApiV1,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const p = contract.push;
const APNS_TOKEN = "a1".repeat(32);
const UNIFIED = {
	transport: "unifiedpush",
	platform: "android",
	endpoint: "https://ntfy.example.org/upAbC123?up=1",
	keys: {
		p256dh:
			"BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
		auth: "tBHItJI5svbpez7KI4CCXg",
	},
};

type Device = {
	id: string;
	transport: string;
	lastSeenAt: string;
	appVersion: string | null;
};

describe("/api/v1/push-devices", () => {
	useApiV1();
	let alice: string;
	let asAlice: Record<string, string>;
	let asBob: Record<string, string>;

	beforeAll(async () => {
		alice = (await createTestUser()).user.id;
		asAlice = await asMobile(alice);
		asBob = await asMobile((await createTestUser()).user.id);
	});

	const register = (
		headers: Record<string, string>,
		body: unknown,
		key?: string,
	) =>
		call("/push-devices", {
			method: "POST",
			headers,
			body,
			idempotent: key ?? true,
		});

	it("registers each transport and never returns the address or keys", async () => {
		const apns = await expectBody<Device>(
			await register(asAlice, {
				transport: "apns",
				platform: "ios",
				token: APNS_TOKEN,
				apnsSandbox: true,
				appVersion: "1.0.0",
				deviceName: "iPhone 15",
			}),
			p.register,
		);
		expect(apns).toMatchObject({
			transport: "apns",
			platform: "ios",
			apnsSandbox: true,
		});
		const fcm = await register(asAlice, {
			transport: "fcm",
			platform: "android",
			token: "fcm:abc",
		});
		await expectBody(fcm, p.register);
		const up = await register(asAlice, UNIFIED);
		const body = await up.text();
		expect(body).not.toContain(UNIFIED.keys.auth);
		expect(body).not.toContain("ntfy.example.org");
		const row = await adminDb.pushDevice.findFirstOrThrow({
			where: { userId: alice, transport: "UNIFIEDPUSH" },
		});
		expect(row).toMatchObject({
			endpoint: UNIFIED.endpoint,
			auth: UNIFIED.keys.auth,
			token: null,
		});
	});

	it("refreshes a known address instead of adding a row", async () => {
		const before = await adminDb.pushDevice.findFirstOrThrow({
			where: { userId: alice, transport: "APNS" },
		});
		const again = await expectBody<Device>(
			await register(asAlice, {
				transport: "apns",
				platform: "ios",
				token: APNS_TOKEN.toUpperCase(),
				appVersion: "1.1.0",
			}),
			p.register,
		);
		expect(again.id).toBe(before.id);
		expect(again.appVersion).toBe("1.1.0");
		expect(new Date(again.lastSeenAt).getTime()).toBeGreaterThanOrEqual(
			before.lastSeenAt.getTime(),
		);
		await expect(
			adminDb.pushDevice.count({ where: { userId: alice, transport: "APNS" } }),
		).resolves.toBe(1);
	});

	it("refuses mismatched or unsafe registrations", async () => {
		await expectProblem(
			await register(asAlice, {
				transport: "apns",
				platform: "android",
				token: APNS_TOKEN,
			}),
			400,
			"validation_failed",
		);
		await expectProblem(
			await register(asAlice, {
				...UNIFIED,
				endpoint: "http://ntfy.example.org/up",
			}),
			400,
			"validation_failed",
		);
		await expectProblem(
			await register(asAlice, {
				transport: "fcm",
				platform: "web",
				token: "x",
			}),
			400,
			"validation_failed",
		);
	});

	it("keeps the address check in the table itself", async () => {
		await expect(
			adminDb.pushDevice.create({
				data: {
					userId: alice,
					platform: "ANDROID",
					transport: "UNIFIEDPUSH",
					token: "only-a-token",
					addressHash: randomUUID(),
				},
			}),
		).rejects.toThrow();
	});

	it("replays a registration and writes once", async () => {
		const user = (await createTestUser()).user.id;
		const as = await asMobile(user);
		const key = randomUUID();
		const body = { transport: "fcm", platform: "android", token: "fcm:replay" };
		const first = await register(as, body, key);
		const second = await register(as, body, key);
		expect(second.headers.get("idempotent-replayed")).toBe("true");
		expect(await second.json()).toEqual(await first.json());
		await expect(
			adminDb.pushDevice.count({ where: { userId: user } }),
		).resolves.toBe(1);
	});

	it("lists most recent first and removes only the caller's devices (RLS)", async () => {
		const list = await expectBody<{
			items: Device[];
			nextCursor: string | null;
		}>(await call("/push-devices?limit=2", { headers: asAlice }), p.list);
		expect(list.items).toHaveLength(2);
		expect(list.items[0]?.transport).toBe("apns");
		const rest = await expectBody<{ items: Device[] }>(
			await call(`/push-devices?limit=2&cursor=${list.nextCursor}`, {
				headers: asAlice,
			}),
			p.list,
		);
		expect(rest.items).toHaveLength(1);

		const bobs = await expectBody<{ items: Device[] }>(
			await call("/push-devices", { headers: asBob }),
			p.list,
		);
		expect(bobs.items).toEqual([]);
		const target = list.items[0]?.id;
		await expectProblem(
			await call(`/push-devices/${target}`, {
				method: "DELETE",
				headers: asBob,
				idempotent: true,
			}),
			404,
			"not_found",
		);
		await expectBody(
			await call(`/push-devices/${target}`, {
				method: "DELETE",
				headers: asAlice,
				idempotent: true,
			}),
			p.remove,
		);
		await expect(
			adminDb.pushDevice.count({ where: { id: target } }),
		).resolves.toBe(0);
	});
});
