/**
 * The web feedback inbox on real Postgres (RLS on): only an admin lists the
 * inbox and the error reports, a member is refused, an admin reads reports of
 * every person (a member's own scoped connection sees only their own), and
 * deleting an entry removes its private screenshot.
 */
import { Readable } from "node:stream";
import { TRPCError } from "@trpc/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createCallerFactory } from "~/server/api/trpc";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import { feedbackRouter } from "../feedback";

const files = new Map<string, Buffer>();
vi.mock("~/server/storage", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/storage")>()),
	uploadFile: vi.fn(),
	deleteFile: vi.fn(async (path: string) => {
		files.delete(path);
	}),
	getFileStream: vi.fn(async (path: string) => Readable.from(files.get(path) ?? "")),
}));

type Made = Awaited<ReturnType<typeof createTestUser>>;

const as = (u: Made, role: "ADMIN" | "USER") =>
	createCallerFactory(feedbackRouter)({
		session: makeSession({ id: u.user.id, name: u.user.name, role }),
		db: u.db,
		headers: new Headers(),
	});

describe("feedback inbox and error reports (web admin)", () => {
	let admin: Made;
	let bob: Made;
	let eve: Made;

	beforeAll(async () => {
		admin = await createTestUser({ role: "ADMIN" });
		bob = await createTestUser();
		eve = await createTestUser();
		const report = (userId: string, message: string) => ({
			userId,
			kind: "crash",
			message,
			stack: "Error: boom\n  at Screen (app.js:1:1)",
			screen: "/budget",
			appVersion: "1.2.0",
			build: "42",
			os: "iOS 19.1",
			device: "iPhone 15",
			occurredAt: new Date(),
		});
		await adminDb.errorReport.createMany({
			data: [report(bob.user.id, "from bob"), report(eve.user.id, "from eve")],
		});
	});

	it("refuses a member the inbox and the error reports", async () => {
		const member = as(bob, "USER");
		await expect(member.list({})).rejects.toBeInstanceOf(TRPCError);
		await expect(member.errorReports({})).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
		await expect(member.deleteErrorReport({ id: "x" })).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
		await expect(member.delete({ id: "x" })).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("shows an admin every person's reports, newest first", async () => {
		const page = await as(admin, "ADMIN").errorReports({ limit: 100 });
		const messages = page.items.map((r) => r.message);
		expect(messages).toEqual(expect.arrayContaining(["from bob", "from eve"]));
		expect(page.total).toBeGreaterThanOrEqual(2);
		const stamps = page.items.map((r) => r.createdAt.getTime());
		expect([...stamps].sort((a, b) => b - a)).toEqual(stamps);
		expect(page.items[0]?.user.name).toBeTruthy();
		// A member's own connection still sees only their own (RLS).
		const own = await bob.db.errorReport.findMany();
		expect(own.map((r) => r.message)).toEqual(["from bob"]);
	});

	it("pages with a cursor", async () => {
		const caller = as(admin, "ADMIN");
		const first = await caller.errorReports({ limit: 1 });
		expect(first.items).toHaveLength(1);
		expect(first.nextCursor).toBeTruthy();
		const second = await caller.errorReports({
			limit: 1,
			cursor: first.nextCursor,
		});
		expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
	});

	it("lets an admin delete a report", async () => {
		const row = await adminDb.errorReport.create({
			data: {
				userId: eve.user.id,
				kind: "render",
				message: "to delete",
				occurredAt: new Date(),
			},
		});
		await as(admin, "ADMIN").deleteErrorReport({ id: row.id });
		await expect(
			adminDb.errorReport.findUnique({ where: { id: row.id } }),
		).resolves.toBeNull();
	});

	it("marks read, saves a note and deletes an entry with its screenshot", async () => {
		const row = await adminDb.feedback.create({
			data: {
				userId: bob.user.id,
				message: "It crashed",
				pageUrl: "app:/budget",
				category: "bug",
				screenshotPath: "feedback/test-entry.webp",
			},
		});
		files.set("feedback/test-entry.webp", Buffer.from("x"));
		const caller = as(admin, "ADMIN");
		const inbox = await caller.list({ status: "unread", limit: 100 });
		const listed = inbox.items.find((i) => i.id === row.id);
		expect(listed).toMatchObject({
			category: "bug",
			screenshotPath: "feedback/test-entry.webp",
		});
		await caller.updateStatus({ id: row.id, status: "read" });
		await caller.addNote({ id: row.id, note: " call back " });
		await expect(
			adminDb.feedback.findUniqueOrThrow({ where: { id: row.id } }),
		).resolves.toMatchObject({ status: "read", adminNote: "call back" });
		await caller.delete({ id: row.id });
		expect(files.has("feedback/test-entry.webp")).toBe(false);
		await expect(
			adminDb.feedback.findUnique({ where: { id: row.id } }),
		).resolves.toBeNull();
	});
});
