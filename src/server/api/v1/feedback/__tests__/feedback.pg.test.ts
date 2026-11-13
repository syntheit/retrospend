/**
 * Mobile feedback and error reports on Postgres: category and diagnostics on
 * a feedback entry, a private re-encoded screenshot only the sender can
 * attach and only an admin can read, and the app's crash reports (scrubbed
 * again on the server, capped per person, admin-visible, own-row RLS).
 */
import { Readable } from "node:stream";
import { contract } from "@retrospend/api-contract";
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	ARCHIVED_SCREENSHOT_RETENTION_DAYS,
	sweepSupportData,
} from "~/server/services/api-v1/retention-sweep";
import { anonymizeAndDeleteUser } from "~/server/services/user-deletion.service";
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

// The upload store stays in memory: the test checks what is stored and read.
const files = new Map<string, Buffer>();
vi.mock("~/server/storage", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/storage")>()),
	uploadFile: vi.fn(async (path: string, buffer: Buffer) => {
		files.set(path, buffer);
		return path;
	}),
	deleteFile: vi.fn(async (path: string) => {
		files.delete(path);
	}),
	getFileStream: vi.fn(async (path: string) => {
		const buffer = files.get(path);
		if (!buffer) throw new Error("missing");
		return Readable.from(buffer);
	}),
}));

const f = contract.feedback;
const a = contract.admin;

async function shot(width = 2400) {
	const png = await sharp({
		create: { width, height: 40, channels: 3, background: "#336699" },
	})
		.png()
		.toBuffer();
	const form = new FormData();
	form.append(
		"file",
		new File([new Uint8Array(png)], "shot.png", { type: "image/png" }),
	);
	return form;
}

const report = (over: Record<string, unknown> = {}) => ({
	kind: "crash",
	message: "boom",
	occurredAt: new Date().toISOString(),
	...over,
});

describe("/api/v1/feedback and /error-reports", () => {
	let admin: string;
	let bob: string;
	let eve: string;
	let asAdmin: Record<string, string>;
	let asBob: Record<string, string>;
	let asEve: Record<string, string>;

	beforeAll(async () => {
		admin = (await createTestUser({ role: "ADMIN" })).user.id;
		bob = (await createTestUser()).user.id;
		eve = (await createTestUser()).user.id;
		asAdmin = await asKey(admin, ["admin"]);
		asBob = await asKey(bob, ["read", "write:settings"]);
		asEve = await asKey(eve, ["read", "write:settings"]);
	});

	const send = (headers: Record<string, string>, body: unknown) =>
		call("/feedback", { method: "POST", headers, body, idempotent: true });

	it("stores the category and the diagnostics the person chose", async () => {
		const sent = await expectBody<{ id: string }>(
			await send(asBob, {
				message: "The sheet jumps",
				pageUrl: "/(tabs)/home",
				category: "bug",
				diagnostics: {
					appVersion: "0.5.0",
					os: "iOS 19",
					device: "iPhone15,4",
					recentErrors: [report()],
				},
			}),
			f.submit,
			201,
		);
		const row = await adminDb.feedback.findUniqueOrThrow({
			where: { id: sent.id },
		});
		expect(row.category).toBe("bug");
		expect(row.diagnostics).toMatchObject({ os: "iOS 19" });

		const plain = await expectBody<{ id: string }>(
			await send(asBob, { message: "No extras", pageUrl: "/x" }),
			f.submit,
			201,
		);
		const bare = await adminDb.feedback.findUniqueOrThrow({
			where: { id: plain.id },
		});
		expect(bare.category).toBe("other");
		expect(bare.diagnostics).toBeNull();
	});

	it("refuses an unknown category", async () => {
		const res = await send(asEve, {
			message: "x",
			pageUrl: "/x",
			category: "praise",
		});
		expect(res.status).toBe(400);
	});

	it("keeps a screenshot private, re-encoded, and readable by an admin only", async () => {
		const sent = await expectBody<{ id: string }>(
			await send(asBob, { message: "See this", pageUrl: "/x" }),
			f.submit,
			201,
		);
		const put = (headers: Record<string, string>, form: FormData) =>
			call(`/feedback/${sent.id}/screenshot`, {
				method: "PUT",
				headers,
				form,
				idempotent: true,
			});

		await expectProblem(await put(asEve, await shot()), 404, "not_found");
		await expectBody(await put(asBob, await shot()), f.attachScreenshot);

		const row = await adminDb.feedback.findUniqueOrThrow({
			where: { id: sent.id },
		});
		expect(row.screenshotPath).toMatch(/^feedback\/.+\.webp$/);
		const stored = files.get(row.screenshotPath ?? "");
		const meta = await sharp(stored).metadata();
		expect(meta.format).toBe("webp");
		expect(meta.width).toBe(1200);

		const inbox = await expectBody<{
			items: {
				id: string;
				category: string;
				hasScreenshot: boolean;
				diagnostics: unknown;
			}[];
		}>(
			await call("/admin/feedback?limit=100", { headers: asAdmin }),
			a.listFeedback,
		);
		const entry = inbox.items.find((i) => i.id === sent.id);
		expect(entry).toMatchObject({ category: "other", hasScreenshot: true });

		const image = await call(`/admin/feedback/${sent.id}/screenshot`, {
			headers: asAdmin,
		});
		expect(image.status).toBe(200);
		expect(image.headers.get("content-type")).toContain("image/webp");
		const asUser = await call(`/admin/feedback/${sent.id}/screenshot`, {
			headers: asBob,
		});
		expect(asUser.status).toBe(403);

		// The admin's read is in the sender's access log, once; the refused
		// read by a plain user and the admin's own log have nothing.
		const reads = (userId: string) =>
			adminDb.adminAccessLog.findMany({
				where: { userId, action: "feedback_screenshot_viewed" },
			});
		expect(await reads(bob)).toMatchObject([{ adminId: admin }]);
		expect(await reads(admin)).toEqual([]);
		await call(`/admin/feedback/${sent.id}/screenshot`, { headers: asAdmin });
		expect(await reads(bob)).toHaveLength(1);

		// A new file is written over the old one: one path, no orphan.
		const before = row.screenshotPath ?? "";
		const count = files.size;
		await expectBody(await put(asBob, await shot(600)), f.attachScreenshot);
		expect(files.size).toBe(count);
		expect((await sharp(files.get(before)).metadata()).width).toBe(600);

		// Deleting the entry deletes the picture.
		const after = (
			await adminDb.feedback.findUniqueOrThrow({ where: { id: sent.id } })
		).screenshotPath;
		expect(files.has(after ?? "")).toBe(true);
		expect(
			(
				await call(`/admin/feedback/${sent.id}`, {
					method: "DELETE",
					headers: asAdmin,
					idempotent: true,
				})
			).status,
		).toBe(200);
		expect(files.has(after ?? "")).toBe(false);
	});

	it("refuses a file that is not a picture", async () => {
		const sent = await expectBody<{ id: string }>(
			await send(asEve, { message: "Not a picture", pageUrl: "/x" }),
			f.submit,
			201,
		);
		const form = new FormData();
		form.append(
			"file",
			new File([new Uint8Array(64)], "x.png", { type: "image/png" }),
		);
		const res = await call(`/feedback/${sent.id}/screenshot`, {
			method: "PUT",
			headers: asEve,
			form,
			idempotent: true,
		});
		expect(res.status).toBe(400);
	});

	const sendReports = (headers: Record<string, string>, reports: unknown[]) =>
		call("/error-reports", {
			method: "POST",
			headers,
			body: { reports },
			idempotent: true,
		});

	it("stores reports scrubbed and lists them for an admin", async () => {
		const res = await sendReports(asBob, [
			report({
				kind: "rejection",
				message:
					"Failed https://me.example/api/v1/expenses/abc for bob@example.com paying $1,234.50",
				stack:
					"at go (https://me.example/bundle.js:12:3)\nBearer abcdef.ghijkl",
				screen: "/(tabs)/activity/clx9f2k3j0000abc123?tab=1",
				os: "iOS 19",
			}),
		]);
		expect(await expectBody(res, f.submitErrorReports, 201)).toMatchObject({
			stored: 1,
		});

		const page = await expectBody<{
			items: {
				id: string;
				message: string;
				stack: string | null;
				screen: string | null;
				user: { id: string };
			}[];
			total: number;
		}>(
			await call("/admin/error-reports?limit=100", { headers: asAdmin }),
			a.listErrorReports,
		);
		const mine = page.items.find((i) => i.user.id === bob);
		expect(mine?.message).toBe(
			"Failed /api/expenses/:id for <email> paying $#",
		);
		expect(mine?.stack).toBe("at bundle.js:12:3");
		expect(mine?.screen).toBe("/(tabs)/activity/:id");
		expect(page.total).toBeGreaterThanOrEqual(1);

		await expectProblem(
			await call("/admin/error-reports", { headers: asBob }),
			403,
			"missing_scope",
		);
		expect(
			(
				await call(`/admin/error-reports/${mine?.id}`, {
					method: "DELETE",
					headers: asAdmin,
					idempotent: true,
				})
			).status,
		).toBe(200);
		await expect(
			adminDb.errorReport.findUnique({ where: { id: mine?.id ?? "" } }),
		).resolves.toBeNull();
	});

	it("takes at most 20 a call and keeps the newest 200 per person", async () => {
		expect(
			(
				await sendReports(
					asEve,
					Array.from({ length: 21 }, () => report()),
				)
			).status,
		).toBe(400);
		for (let n = 0; n < 11; n++)
			expect(
				(
					await sendReports(
						asEve,
						Array.from({ length: 20 }, (_, i) =>
							report({ message: `m${n}-${i}` }),
						),
					)
				).status,
			).toBe(201);
		expect(await adminDb.errorReport.count({ where: { userId: eve } })).toBe(
			200,
		);
	});

	it("scrubs the recent errors sent with feedback, as it does error reports", async () => {
		const person = (await createTestUser()).user.id;
		const sent = await expectBody<{ id: string }>(
			await send(await asKey(person, ["read", "write:settings"]), {
				message: "Crashes",
				pageUrl: "app:/x",
				diagnostics: {
					recentErrors: [
						report({
							message: 'paid 1500 to "Lucia" at example.com/people/lucia',
							stack: "TypeError: x\n    at f (index.bundle:5:6)",
						}),
					],
				},
			}),
			f.submit,
			201,
		);
		const row = await adminDb.feedback.findUniqueOrThrow({
			where: { id: sent.id },
		});
		const stored = JSON.stringify(row.diagnostics);
		expect(stored).not.toMatch(/1500|Lucia|lucia|example\.com/);
		expect(stored).toContain("at index.bundle:5:6");
	});

	it("limits screenshot uploads to 5 a minute per person", async () => {
		const person = (await createTestUser()).user.id;
		const asPerson = await asKey(person, ["read", "write:settings"]);
		const sent = await expectBody<{ id: string }>(
			await send(asPerson, { message: "Many pictures", pageUrl: "app:/x" }),
			f.submit,
			201,
		);
		const put = async () =>
			call(`/feedback/${sent.id}/screenshot`, {
				method: "PUT",
				headers: asPerson,
				form: await shot(100),
				idempotent: true,
			});
		// The window is a fixed minute, so six slow uploads under load could
		// straddle a boundary and land in two windows. Hold the clock still.
		const minute = Math.floor(Date.now() / 60_000) * 60_000;
		vi.useFakeTimers({ toFake: ["Date"], now: minute + 1_000 });
		try {
			for (let n = 0; n < 5; n++) expect((await put()).status).toBe(200);
			await expectProblem(await put(), 429, "rate_limited");
		} finally {
			vi.useRealTimers();
		}
	});

	it("leaves one file when uploads arrive at the same moment", async () => {
		const person = (await createTestUser()).user.id;
		const asPerson = await asKey(person, ["read", "write:settings"]);
		const sent = await expectBody<{ id: string }>(
			await send(asPerson, { message: "Race", pageUrl: "app:/x" }),
			f.submit,
			201,
		);
		const before = files.size;
		const results = await Promise.all(
			[100, 200, 300].map(async (w) =>
				call(`/feedback/${sent.id}/screenshot`, {
					method: "PUT",
					headers: asPerson,
					form: await shot(w),
					idempotent: true,
				}),
			),
		);
		for (const res of results) expect(res.status).toBe(200);
		expect(files.size).toBe(before + 1);
	});

	it("removes screenshots with the account", async () => {
		const person = await createTestUser();
		const asPerson = await asKey(person.user.id, ["read", "write:settings"]);
		const sent = await expectBody<{ id: string }>(
			await send(asPerson, { message: "Bye", pageUrl: "app:/x" }),
			f.submit,
			201,
		);
		await call(`/feedback/${sent.id}/screenshot`, {
			method: "PUT",
			headers: asPerson,
			form: await shot(100),
			idempotent: true,
		});
		const path = (
			await adminDb.feedback.findUniqueOrThrow({ where: { id: sent.id } })
		).screenshotPath;
		expect(files.has(path ?? "")).toBe(true);
		await anonymizeAndDeleteUser(
			adminDb,
			person.user.id,
			person.user.email,
			null,
		);
		expect(files.has(path ?? "")).toBe(false);
	});

	it("keeps error reports 30 days and archived screenshots 180", async () => {
		const person = (await createTestUser()).user.id;
		const day = 24 * 60 * 60 * 1000;
		const now = new Date();
		const ago = (days: number) => new Date(now.getTime() - days * day);
		const mk = (days: number, extra: Record<string, unknown> = {}) =>
			adminDb.errorReport.create({
				data: {
					userId: person,
					kind: "crash",
					message: "m",
					occurredAt: ago(days),
					createdAt: ago(days),
					...extra,
				},
			});
		// Written out, so changing the limit fails here: 29 stays, 31 goes.
		const oldReport = await mk(31);
		const freshReport = await mk(29);

		const entry = (status: string, days: number, name: string) => {
			files.set(`feedback/${name}.webp`, Buffer.from("x"));
			return adminDb.feedback.create({
				data: {
					userId: person,
					message: name,
					pageUrl: "app:/x",
					status,
					screenshotPath: `feedback/${name}.webp`,
					updatedAt: ago(days),
				},
			});
		};
		const oldArchived = await entry(
			"archived",
			ARCHIVED_SCREENSHOT_RETENTION_DAYS + 1,
			"old-archived",
		);
		const freshArchived = await entry(
			"archived",
			ARCHIVED_SCREENSHOT_RETENTION_DAYS - 1,
			"fresh-archived",
		);
		const oldUnread = await entry(
			"unread",
			ARCHIVED_SCREENSHOT_RETENTION_DAYS + 30,
			"old-unread",
		);

		await sweepSupportData(now);

		await expect(
			adminDb.errorReport.findUnique({ where: { id: oldReport.id } }),
		).resolves.toBeNull();
		await expect(
			adminDb.errorReport.findUnique({ where: { id: freshReport.id } }),
		).resolves.not.toBeNull();
		const rows = await adminDb.feedback.findMany({
			where: { id: { in: [oldArchived.id, freshArchived.id, oldUnread.id] } },
		});
		const byMessage = Object.fromEntries(rows.map((r) => [r.message, r]));
		expect(byMessage["old-archived"]?.screenshotPath).toBeNull();
		expect(files.has("feedback/old-archived.webp")).toBe(false);
		expect(byMessage["old-archived"]?.message).toBe("old-archived");
		expect(byMessage["fresh-archived"]?.screenshotPath).not.toBeNull();
		expect(byMessage["old-unread"]?.screenshotPath).not.toBeNull();
	});

	it("needs a write scope and a signed-in caller", async () => {
		const readOnly = await asKey(bob, ["read"]);
		await expectProblem(
			await sendReports(readOnly, [report()]),
			403,
			"missing_scope",
		);
		await expectProblem(
			await sendReports({}, [report()]),
			401,
			"unauthenticated",
		);
	});
});
