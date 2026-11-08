/**
 * Admin reads on real Postgres (RLS on). An admin reading one person's data
 * writes one entry in that person's access log; opening a list across many
 * people writes none there and one event in the admin audit instead; a
 * refused, invalid or empty read writes nothing; and a person still sees only
 * their own entries.
 */
import { Readable } from "node:stream";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminRouter } from "~/server/api/routers/admin";
import { adminAccessRouter } from "~/server/api/routers/admin-access";
import { feedbackRouter } from "~/server/api/routers/feedback";
import { inviteRouter } from "~/server/api/routers/invite";
import { createCallerFactory } from "~/server/api/trpc";
import { openFeedbackScreenshotAsAdmin } from "~/server/services/feedback-screenshot.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";

const files = new Map<string, Buffer>();
vi.mock("~/server/storage", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/storage")>()),
	getFileStream: vi.fn(async (path: string) => {
		const buffer = files.get(path);
		if (!buffer) throw new Error("missing");
		return Readable.from(buffer);
	}),
}));

type Made = Awaited<ReturnType<typeof createTestUser>>;

const context = (u: Made, role: "ADMIN" | "USER") => ({
	session: makeSession({ id: u.user.id, name: u.user.name, role }),
	db: u.db,
	headers: new Headers(),
});

const adminAs = (u: Made, role: "ADMIN" | "USER" = "ADMIN") =>
	createCallerFactory(adminRouter)(context(u, role));
const feedbackAs = (u: Made, role: "ADMIN" | "USER" = "ADMIN") =>
	createCallerFactory(feedbackRouter)(context(u, role));
const inviteAs = (u: Made, role: "ADMIN" | "USER" = "ADMIN") =>
	createCallerFactory(inviteRouter)(context(u, role));
const accessAs = (u: Made, role: "ADMIN" | "USER" = "USER") =>
	createCallerFactory(adminAccessRouter)(context(u, role));

const listEvents = (adminId: string) =>
	adminDb.eventLog.findMany({
		where: { eventType: "ADMIN_LIST_VIEWED", userId: adminId },
		orderBy: { timestamp: "asc" },
	});

const accessEntries = (userId: string) =>
	adminDb.adminAccessLog.findMany({
		where: { userId },
		orderBy: { createdAt: "asc" },
	});

describe("admin reads: lists across many people go to the admin audit", () => {
	let bob: Made;

	beforeAll(async () => {
		bob = await createTestUser();
	});

	it("writes one admin audit event and nothing in anyone's own log", async () => {
		const a = await createTestUser({ role: "ADMIN" });
		await adminAs(a).listUsers();

		const events = await listEvents(a.user.id);
		expect(events).toHaveLength(1);
		expect(events[0]?.metadata).toEqual({ adminId: a.user.id, view: "users" });
		expect(await accessEntries(bob.user.id)).toEqual([]);
		expect(await accessEntries(a.user.id)).toEqual([]);
	});

	it("covers every list view, each under its own name", async () => {
		const a = await createTestUser({ role: "ADMIN" });
		const cases: Array<[string, () => Promise<unknown>]> = [
			["users", () => adminAs(a).listUsers()],
			["event_log", () => adminAs(a).getEventLogsCursor({})],
			["ai_usage", () => adminAs(a).getAiUsageStats()],
			["shadow_profiles", () => adminAs(a).listShadowProfiles()],
			["guest_sessions", () => adminAs(a).listGuestSessions()],
			["feedback", () => feedbackAs(a).list({})],
			["error_reports", () => feedbackAs(a).errorReports({})],
			["invites", () => inviteAs(a).list({})],
		];
		for (const [, read] of cases) await read();

		const views = (await listEvents(a.user.id)).map(
			(e) => (e.metadata as { view: string }).view,
		);
		expect(views.sort()).toEqual(cases.map(([view]) => view).sort());
	});

	it("counts the offset form of the event log too, first page only", async () => {
		const a = await createTestUser({ role: "ADMIN" });
		await adminAs(a).getEventLogs({ limit: 10, offset: 10 });
		expect(await listEvents(a.user.id)).toHaveLength(0);
		await adminAs(a).getEventLogs({ limit: 10, offset: 0 });
		expect(await listEvents(a.user.id)).toHaveLength(1);
	});

	it("writes nothing for a page after the first", async () => {
		const a = await createTestUser({ role: "ADMIN" });
		await adminAs(a).getEventLogsCursor({
			cursor: new Date().toISOString(),
		});
		await feedbackAs(a).list({ cursor: "some-id" });
		await inviteAs(a).list({ page: 2 });
		expect(await listEvents(a.user.id)).toHaveLength(0);
	});

	it("writes one event for the same list opened again within minutes", async () => {
		const a = await createTestUser({ role: "ADMIN" });
		await adminAs(a).listUsers();
		await adminAs(a).listUsers();
		await adminAs(a).listUsers();
		expect(await listEvents(a.user.id)).toHaveLength(1);
	});

	it("writes nothing when the caller is not an admin", async () => {
		const m = await createTestUser();
		await expect(adminAs(m, "USER").listUsers()).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
		await expect(feedbackAs(m, "USER").list({})).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
		expect(await listEvents(m.user.id)).toHaveLength(0);
	});

	it("writes nothing when the request is invalid", async () => {
		const a = await createTestUser({ role: "ADMIN" });
		await expect(
			adminAs(a).getEventLogs({ limit: 0 }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			feedbackAs(a).errorReports({ limit: 1000 }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(await listEvents(a.user.id)).toHaveLength(0);
	});

	it("writes nothing for figures that hold no one's data", async () => {
		const a = await createTestUser({ role: "ADMIN" });
		await adminAs(a).getStats();
		await adminAs(a).getServerStats();
		await feedbackAs(a).unreadCount();
		expect(await listEvents(a.user.id)).toHaveLength(0);
	});
});

describe("admin reads: one person's data goes to their own log", () => {
	let adminUser: Made;
	let bob: Made;
	let eve: Made;

	const feedbackFor = async (
		user: Made,
		screenshotPath: string | null,
		bytes?: string,
	) => {
		if (screenshotPath && bytes) files.set(screenshotPath, Buffer.from(bytes));
		return adminDb.feedback.create({
			data: {
				userId: user.user.id,
				message: "It broke",
				pageUrl: "/home",
				screenshotPath,
			},
		});
	};

	const drain = async (stream: NodeJS.ReadableStream) => {
		const chunks: Buffer[] = [];
		for await (const c of stream) chunks.push(Buffer.from(c));
		return Buffer.concat(chunks).toString();
	};

	beforeAll(async () => {
		adminUser = await createTestUser({ role: "ADMIN" });
		bob = await createTestUser();
		eve = await createTestUser();
	});

	it("an admin reading bob's screenshot writes one entry for bob, shown to bob only", async () => {
		const fb = await feedbackFor(bob, "feedback/bob-1.webp", "bob-picture");
		const stream = await openFeedbackScreenshotAsAdmin(
			adminUser.user.id,
			fb.id,
		);

		expect(stream && (await drain(stream))).toBe("bob-picture");
		const rows = await accessEntries(bob.user.id);
		expect(rows.map((r) => [r.action, r.adminId])).toEqual([
			["feedback_screenshot_viewed", adminUser.user.id],
		]);
		expect(
			(await accessAs(bob, "USER").list()).map((r) => r.action),
		).toEqual(["feedback_screenshot_viewed"]);
		expect(await accessAs(eve, "USER").list()).toEqual([]);
		expect(await accessEntries(eve.user.id)).toEqual([]);
		expect(await accessEntries(adminUser.user.id)).toEqual([]);
		expect(await listEvents(adminUser.user.id)).toEqual([]);
	});

	it("the same admin opening the same picture again within minutes adds no second entry", async () => {
		const fb = await feedbackFor(eve, "feedback/eve-1.webp", "eve-picture");
		await openFeedbackScreenshotAsAdmin(adminUser.user.id, fb.id);
		await openFeedbackScreenshotAsAdmin(adminUser.user.id, fb.id);
		expect(await accessEntries(eve.user.id)).toHaveLength(1);

		// A different admin is a different reader.
		const other = await createTestUser({ role: "ADMIN" });
		await openFeedbackScreenshotAsAdmin(other.user.id, fb.id);
		expect(await accessEntries(eve.user.id)).toHaveLength(2);
	});

	it("an entry with no picture, a missing file or an unknown id writes nothing", async () => {
		const carol = await createTestUser();
		const none = await feedbackFor(carol, null);
		const gone = await feedbackFor(carol, "feedback/carol-gone.webp");
		expect(
			await openFeedbackScreenshotAsAdmin(adminUser.user.id, none.id),
		).toBeNull();
		expect(
			await openFeedbackScreenshotAsAdmin(adminUser.user.id, gone.id),
		).toBeNull();
		expect(
			await openFeedbackScreenshotAsAdmin(adminUser.user.id, "no-such-id"),
		).toBeNull();
		expect(await accessEntries(carol.user.id)).toEqual([]);
	});

	it("bob cannot read, add or erase the entry about him", async () => {
		const rows = await accessEntries(bob.user.id);
		expect(rows).toHaveLength(1);
		expect(
			await eve.db.adminAccessLog.findUnique({ where: { id: rows[0]?.id } }),
		).toBeNull();
		await expect(
			bob.db.adminAccessLog.deleteMany({ where: { userId: bob.user.id } }),
		).rejects.toThrow();
		expect(await accessEntries(bob.user.id)).toHaveLength(1);
	});
});
