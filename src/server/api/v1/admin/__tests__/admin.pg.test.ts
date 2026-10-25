/**
 * /api/v1/admin on Postgres: users, settings, event logs, backups, invite
 * codes and the feedback inbox, as an admin; what a plain user and a
 * demoted admin cannot do; and that no response carries another user's
 * titles or notes.
 */
import { contract } from "@retrospend/api-contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getAppSettings, updateAppSettings } from "~/server/services/settings";
import {
	adminDb,
	asKey,
	call,
	createTestUser,
	expectBody,
	expectProblem,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const a = contract.admin;
const SECRET = "SECRET-TITLE-Q7";

describe("/api/v1/admin", () => {
	let admin: string;
	let bob: string;
	let asAdmin: Record<string, string>;
	let asBob: Record<string, string>;
	let initial: Awaited<ReturnType<typeof getAppSettings>>;
	/** Every body an admin read returned, to prove none holds user text. */
	const seen: string[] = [];

	beforeAll(async () => {
		initial = await getAppSettings();
		admin = (await createTestUser({ role: "ADMIN" })).user.id;
		bob = (await createTestUser()).user.id;
		asAdmin = await asKey(admin, ["admin"]);
		asBob = await asKey(bob, ["read", "write:settings"]);
		await adminDb.expense.create({
			data: {
				userId: bob,
				title: SECRET,
				description: `${SECRET} note`,
				amount: 5,
				currency: "USD",
				date: new Date(),
				amountInUSD: 5,
				exchangeRate: 1,
				pricingSource: "MANUAL",
			},
		});
	});

	afterAll(async () => {
		await updateAppSettings({
			inviteOnlyEnabled: initial.inviteOnlyEnabled,
			allowAllUsersToGenerateInvites: initial.allowAllUsersToGenerateInvites,
			enableEmail: initial.enableEmail,
			auditPrivacyMode: initial.auditPrivacyMode,
			maxConcurrentImportJobs: initial.maxConcurrentImportJobs,
			enableFeedback: initial.enableFeedback,
			defaultAiMode: initial.defaultAiMode,
			externalAiAccessMode: initial.externalAiAccessMode,
			monthlyAiTokenQuota: initial.monthlyAiTokenQuota,
		});
	});

	async function read<T>(
		path: string,
		procedure: { "~orpc": { outputSchema?: unknown } },
	) {
		const res = await call(path, { headers: asAdmin });
		const text = await res.clone().text();
		seen.push(text);
		return expectBody<T>(res, procedure);
	}

	const write = (path: string, method: string, body?: unknown, key?: string) =>
		call(path, { method, headers: asAdmin, body, idempotent: key ?? true });

	it("reads stats", async () => {
		const stats = await read<{
			userCount: number;
			databaseSizeBytes: number;
			importQueue: { maxConcurrent: number; availableSlots: number };
		}>("/admin/stats", a.stats);
		expect(stats.userCount).toBeGreaterThanOrEqual(2);
		expect(stats.importQueue.maxConcurrent).toBeGreaterThanOrEqual(1);
		expect(stats.databaseSizeBytes).toBeGreaterThan(0);
	});

	it("lists accounts with counts and no user text", async () => {
		const page = await read<{
			items: { id: string; expenseCount: number; role: string }[];
			nextCursor: string | null;
		}>("/admin/users?limit=1", a.listUsers);
		expect(page.items).toHaveLength(1);
		expect(page.nextCursor).not.toBeNull();
		const all = await read<{ items: { id: string; expenseCount: number }[] }>(
			"/admin/users?limit=200",
			a.listUsers,
		);
		expect(all.items.find((u) => u.id === bob)?.expenseCount).toBe(1);
		const next = await read<{ items: { id: string }[] }>(
			`/admin/users?limit=1&cursor=${page.nextCursor}`,
			a.listUsers,
		);
		expect(next.items[0]?.id).not.toBe(page.items[0]?.id);
		await expectProblem(
			await call("/admin/users?cursor=bad", { headers: asAdmin }),
			400,
			"bad_request",
		);
	});

	it("disables and enables an account, but never your own", async () => {
		const off = await write(`/admin/users/${bob}/disable`, "POST", {});
		expect(off.status).toBe(200);
		await expect(
			adminDb.user.findUniqueOrThrow({ where: { id: bob } }),
		).resolves.toMatchObject({ isActive: false });
		const on = await write(`/admin/users/${bob}/enable`, "POST", {});
		expect(on.status).toBe(200);
		await expect(
			adminDb.user.findUniqueOrThrow({ where: { id: bob } }),
		).resolves.toMatchObject({ isActive: true });

		await expectProblem(
			await write(`/admin/users/${admin}/disable`, "POST", {}),
			403,
			"forbidden",
		);
		await expectProblem(
			await write(`/admin/users/${admin}`, "DELETE"),
			403,
			"forbidden",
		);
		await expectProblem(
			await write("/admin/users/nobody/enable", "POST", {}),
			404,
			"not_found",
		);
	});

	it("replays a repeated key without disabling twice", async () => {
		const first = await write(
			`/admin/users/${bob}/disable`,
			"POST",
			{},
			"off-1",
		);
		expect(first.status).toBe(200);
		await write(`/admin/users/${bob}/enable`, "POST", {});
		const replay = await write(
			`/admin/users/${bob}/disable`,
			"POST",
			{},
			"off-1",
		);
		expect(replay.headers.get("idempotent-replayed")).toBe("true");
		// The replay wrote nothing: bob is still enabled.
		await expect(
			adminDb.user.findUniqueOrThrow({ where: { id: bob } }),
		).resolves.toMatchObject({ isActive: true });
	});

	it("sets email verification and AI access", async () => {
		const ver = await write(`/admin/users/${bob}/email-verified`, "PUT", {
			verified: true,
		});
		expect(ver.status).toBe(200);
		const ai = await write(`/admin/users/${bob}/ai-access`, "PUT", {
			allowed: false,
		});
		expect(ai.status).toBe(200);
		await expect(
			adminDb.user.findUniqueOrThrow({ where: { id: bob } }),
		).resolves.toMatchObject({ emailVerified: true, externalAiAllowed: false });
		await write(`/admin/users/${bob}/ai-access`, "PUT", { allowed: null });
		await expect(
			adminDb.user.findUniqueOrThrow({ where: { id: bob } }),
		).resolves.toMatchObject({ externalAiAllowed: null });
	});

	it("deletes an account", async () => {
		const gone = (await createTestUser()).user.id;
		const res = await write(`/admin/users/${gone}`, "DELETE");
		expect(res.status).toBe(200);
		await expect(
			adminDb.user.findUnique({ where: { id: gone } }),
		).resolves.toBeNull();
	});

	it("reads and changes server settings, in lower case", async () => {
		const before = await read<{ auditPrivacyMode: string }>(
			"/admin/settings",
			a.getSettings,
		);
		expect(before.auditPrivacyMode).toMatch(/^(minimal|anonymized|full)$/);
		const res = await write("/admin/settings", "PATCH", {
			auditPrivacyMode: "anonymized",
			maxConcurrentImportJobs: 4,
			enableFeedback: true,
		});
		const after = await expectBody<{ auditPrivacyMode: string }>(
			res,
			a.updateSettings,
		);
		expect(after).toMatchObject({
			auditPrivacyMode: "anonymized",
			maxConcurrentImportJobs: 4,
			enableFeedback: true,
		});
		await expectProblem(
			await write("/admin/settings", "PATCH", { maxConcurrentImportJobs: 99 }),
			400,
			"validation_failed",
		);
		const ai = await write("/admin/ai-settings", "PATCH", {
			monthlyAiTokenQuota: 1234,
		});
		expect(await expectBody(ai, a.updateAiSettings)).toMatchObject({
			monthlyAiTokenQuota: 1234,
			openRouterConfigured: false,
		});
		const usage = await read<{ usages: unknown[] }>(
			"/admin/ai-usage?yearMonth=2026-10",
			a.aiUsage,
		);
		expect(usage.usages).toEqual([]);
	});

	it("pages through event logs and drops user text from their metadata", async () => {
		await adminDb.eventLog.createMany({
			data: [
				{
					eventType: "USER_UPDATED",
					userId: bob,
					timestamp: new Date("2026-01-01T00:00:03Z"),
					metadata: {
						field: "avatarPath",
						title: SECRET,
						shadowProfileName: SECRET,
						guestName: SECRET,
						guestEmail: `${SECRET}@x.test`,
						fileName: `${SECRET}.csv`,
						nested: { note: SECRET, kept: 1 },
						targetUsername: "bob",
					},
				},
				{
					eventType: "ACCOUNT_ENABLED",
					userId: bob,
					timestamp: new Date("2026-01-01T00:00:02Z"),
				},
				{
					eventType: "ACCOUNT_ENABLED",
					userId: bob,
					timestamp: new Date("2026-01-01T00:00:01Z"),
				},
			],
		});
		const first = await read<{
			items: { eventType: string; metadata: Record<string, unknown> | null }[];
			nextCursor: string | null;
		}>("/admin/event-logs?limit=2&eventType=USER_UPDATED", a.eventLogs);
		expect(first.items).toHaveLength(1);
		expect(first.items[0]?.metadata).toEqual({
			field: "avatarPath",
			targetUsername: "bob",
		});
		const page = await read<{
			items: { eventType: string }[];
			nextCursor: string | null;
		}>("/admin/event-logs?limit=1&eventType=ACCOUNT_ENABLED", a.eventLogs);
		expect(page.items).toHaveLength(1);
		expect(page.nextCursor).not.toBeNull();
		const more = await read<{ items: { eventType: string }[] }>(
			`/admin/event-logs?limit=5&eventType=ACCOUNT_ENABLED&cursor=${page.nextCursor}`,
			a.eventLogs,
		);
		expect(more.items.length).toBeGreaterThanOrEqual(1);
	});

	it("reports backups as unavailable without a sidecar", async () => {
		const status = await read<{ available: boolean }>(
			"/admin/backups",
			a.getBackups,
		);
		expect(status.available).toBe(false);
		const start = await write("/admin/backups", "POST", {});
		expect(start.status).toBe(500);
	});

	it("manages invite codes, and lets users manage their own only when allowed", async () => {
		const made = await expectBody<{ id: string; code: string; state: string }>(
			await write("/admin/invite-codes", "POST", {}),
			a.createInviteCode,
			201,
		);
		expect(made.code).toMatch(/^[A-Z0-9]{8}$/);
		const list = await read<{ items: { id: string }[] }>(
			"/admin/invite-codes?status=all",
			a.listInviteCodes,
		);
		expect(list.items.map((c) => c.id)).toContain(made.id);

		// A plain user: 403 while the setting is off.
		await updateAppSettings({ allowAllUsersToGenerateInvites: false });
		await expectProblem(
			await call("/invite-codes", { headers: asBob }),
			403,
			"forbidden",
		);
		await updateAppSettings({ allowAllUsersToGenerateInvites: true });
		const mine = await expectBody<{ id: string; code: string }>(
			await call("/invite-codes", {
				method: "POST",
				headers: asBob,
				body: {},
				idempotent: true,
			}),
			contract["invite-codes"].create,
			201,
		);
		const own = await expectBody<{ items: { id: string }[] }>(
			await call("/invite-codes", { headers: asBob }),
			contract["invite-codes"].list,
		);
		expect(own.items.map((c) => c.id)).toEqual([mine.id]);
		// Not theirs: 404, the admin's code stays.
		await expectProblem(
			await call(`/invite-codes/${made.id}`, {
				method: "DELETE",
				headers: asBob,
				idempotent: true,
			}),
			404,
			"not_found",
		);
		expect(
			(
				await call(`/invite-codes/${mine.id}`, {
					method: "DELETE",
					headers: asBob,
					idempotent: true,
				})
			).status,
		).toBe(200);
		expect(
			(await write(`/admin/invite-codes/${made.id}`, "DELETE")).status,
		).toBe(200);
		await expect(
			adminDb.inviteCode.findUnique({ where: { id: made.id } }),
		).resolves.toBeNull();
	});

	it("takes feedback from a user and runs the inbox for an admin", async () => {
		const submit = (message: string) =>
			call("/feedback", {
				method: "POST",
				headers: asBob,
				body: { message, pageUrl: "/budget", appVersion: "1.0" },
				idempotent: true,
			});
		expect((await submit("  Great app  ")).status).toBe(201);
		// Hourly limit: 5 entries.
		for (let n = 0; n < 4; n++)
			expect((await submit(`more ${n}`)).status).toBe(201);
		await expectProblem(await submit("one too many"), 409, "conflict");

		const inbox = await read<{
			items: {
				id: string;
				message: string;
				status: string;
				user: { id: string };
			}[];
			counts: { unread: number; total: number };
		}>("/admin/feedback?status=unread&limit=100", a.listFeedback);
		expect(inbox.counts.unread).toBeGreaterThanOrEqual(5);
		const entry = inbox.items.find((f) => f.message === "  Great app  ");
		expect(entry?.user.id).toBe(bob);

		const id = entry?.id ?? "";
		expect(
			(await write(`/admin/feedback/${id}/status`, "PUT", { status: "read" }))
				.status,
		).toBe(200);
		// The note is kept exactly as sent.
		expect(
			(
				await write(`/admin/feedback/${id}/note`, "PUT", {
					note: "  call back  ",
				})
			).status,
		).toBe(200);
		await expect(
			adminDb.feedback.findUniqueOrThrow({ where: { id } }),
		).resolves.toMatchObject({
			status: "read",
			adminNote: "  call back  ",
		});
		expect(
			(await write(`/admin/feedback/${id}/note`, "PUT", { note: null })).status,
		).toBe(200);
		await expect(
			adminDb.feedback.findUniqueOrThrow({ where: { id } }),
		).resolves.toMatchObject({
			adminNote: null,
		});
		expect((await write(`/admin/feedback/${id}`, "DELETE")).status).toBe(200);
		await expectProblem(
			await write(`/admin/feedback/${id}`, "DELETE"),
			404,
			"not_found",
		);
	});

	it("returned no user title or note anywhere", () => {
		expect(seen.length).toBeGreaterThan(8);
		for (const body of seen) expect(body).not.toContain(SECRET);
	});

	it("stops working for an admin who loses the role", async () => {
		const former = (await createTestUser({ role: "ADMIN" })).user.id;
		const headers = await asKey(former, ["admin"]);
		expect((await call("/admin/stats", { headers })).status).toBe(200);
		await adminDb.user.update({
			where: { id: former },
			data: { role: "USER" },
		});
		await expectProblem(
			await call("/admin/stats", { headers }),
			403,
			"missing_scope",
		);
	});
});
