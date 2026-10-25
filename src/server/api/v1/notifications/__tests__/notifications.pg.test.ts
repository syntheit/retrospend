/**
 * /api/v1/notifications on Postgres: newest-first pages that never skip a
 * row, unread counts, marking read (one or all), preferences with their
 * stored defaults, replays, and RLS between users.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { notificationRouter } from "~/server/api/routers/notification";
import { createCallerFactory } from "~/server/api/trpc";
import { makeSession } from "~/test/trpc-test-utils";
import {
	adminDb,
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const n = contract.notifications;
type Page = {
	items: { id: string; title: string; isRead: boolean }[];
	nextCursor: string | null;
};

async function notify(userId: string, title: string, createdAt: Date) {
	return adminDb.notification.create({
		data: {
			userId,
			type: "EXPENSE_SPLIT",
			title,
			body: "Body",
			data: { transactionId: "tx1" },
			createdAt,
		},
	});
}

describe("/api/v1/notifications", () => {
	let alice: string;
	let asAlice: Record<string, string>;
	let asBob: Record<string, string>;

	beforeAll(async () => {
		alice = (await createTestUser()).user.id;
		asAlice = await asMobile(alice);
		asBob = await asMobile((await createTestUser()).user.id);
		const same = new Date("2026-10-10T10:00:00Z");
		// Three share one instant: pages must still list each once.
		await notify(alice, "n1", new Date("2026-10-09T10:00:00Z"));
		await notify(alice, "n2", same);
		await notify(alice, "n3", same);
		await notify(alice, "n4", same);
		await notify(alice, "n5", new Date("2026-10-11T10:00:00Z"));
	});

	it("pages newest first without skipping or repeating", async () => {
		const seen: string[] = [];
		let cursor: string | null = null;
		do {
			const qs: string = cursor ? `&cursor=${cursor}` : "";
			const page: Page = await expectBody(
				await call(`/notifications?limit=2${qs}`, { headers: asAlice }),
				n.list,
			);
			seen.push(...page.items.map((x) => x.title));
			cursor = page.nextCursor;
		} while (cursor);
		expect(seen).toHaveLength(5);
		expect(new Set(seen).size).toBe(5);
		expect(seen[0]).toBe("n5");
		expect(seen[4]).toBe("n1");
	});

	it("pages the same way through tRPC (one service, two transports)", async () => {
		const caller = createCallerFactory(notificationRouter)({
			session: makeSession({ id: alice }),
			db: adminDb,
			headers: new Headers(),
		} as never);
		const seen: string[] = [];
		let cursor: string | undefined;
		do {
			const page = await caller.list({ limit: 2, cursor });
			seen.push(...page.items.map((x) => x.title));
			cursor = page.nextCursor;
		} while (cursor);
		// The old router dropped the row after each page's last one.
		expect(seen).toEqual(["n5", ...seen.slice(1, 4), "n1"]);
		expect(new Set(seen).size).toBe(5);
	});

	it("refuses a cursor whose notification is gone, or is someone else's", async () => {
		const user = (await createTestUser()).user.id;
		const as = await asMobile(user);
		const gone = await notify(user, "gone", new Date("2026-10-12T10:00:00Z"));
		await notify(user, "older", new Date("2026-10-08T10:00:00Z"));
		const page = await expectBody<Page>(
			await call("/notifications?limit=1", { headers: as }),
			n.list,
		);
		expect(page.items[0]?.id).toBe(gone.id);
		await adminDb.notification.delete({ where: { id: gone.id } });
		await expectProblem(
			await call(`/notifications?limit=1&cursor=${page.nextCursor}`, {
				headers: as,
			}),
			400,
			"bad_request",
		);
		// Alice's cursor names a row this caller cannot see.
		const alices = await expectBody<Page>(
			await call("/notifications?limit=1", { headers: asAlice }),
			n.list,
		);
		await expectProblem(
			await call(`/notifications?limit=1&cursor=${alices.nextCursor}`, {
				headers: as,
			}),
			400,
			"bad_request",
		);
		const caller = createCallerFactory(notificationRouter)({
			session: makeSession({ id: user }),
			db: adminDb,
			headers: new Headers(),
		} as never);
		await expect(
			caller.list({ limit: 1, cursor: gone.id }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("marks one read, then all, and counts unread", async () => {
		const unread = async () =>
			(
				await expectBody<{ count: number }>(
					await call("/notifications/unread-count", { headers: asAlice }),
					n.unreadCount,
				)
			).count;
		expect(await unread()).toBe(5);

		const first = (
			await expectBody<Page>(
				await call("/notifications?limit=1", { headers: asAlice }),
				n.list,
			)
		).items[0];
		await expectBody(
			await call(`/notifications/${first?.id}/read`, {
				method: "POST",
				headers: asAlice,
				idempotent: true,
			}),
			n.markRead,
		);
		expect(await unread()).toBe(4);
		const onlyUnread = await expectBody<Page>(
			await call("/notifications?unreadOnly=true", { headers: asAlice }),
			n.list,
		);
		expect(onlyUnread.items.map((x) => x.id)).not.toContain(first?.id);

		const key = randomUUID();
		const all = await expectBody<{ count: number }>(
			await call("/notifications/read-all", {
				method: "POST",
				headers: asAlice,
				idempotent: key,
			}),
			n.markAllRead,
		);
		expect(all.count).toBe(4);
		const replay = await call("/notifications/read-all", {
			method: "POST",
			headers: asAlice,
			idempotent: key,
		});
		expect(replay.headers.get("idempotent-replayed")).toBe("true");
		expect(await replay.json()).toEqual({ count: 4 });
		expect(await unread()).toBe(0);
	});

	it("keeps users apart (RLS)", async () => {
		const bobs = await expectBody<Page>(
			await call("/notifications", { headers: asBob }),
			n.list,
		);
		expect(bobs.items).toEqual([]);
		const alices = await adminDb.notification.findFirstOrThrow({
			where: { userId: alice },
		});
		await expectProblem(
			await call(`/notifications/${alices.id}/read`, {
				method: "POST",
				headers: asBob,
				idempotent: true,
			}),
			404,
			"not_found",
		);
	});

	it("creates preference defaults once and updates them", async () => {
		const prefs = await expectBody<{
			preferences: { type: string; email: boolean; inApp: boolean }[];
		}>(
			await call("/notifications/preferences", { headers: asAlice }),
			n.getPreferences,
		);
		expect(prefs.preferences).toHaveLength(10);
		expect(
			prefs.preferences
				.filter((p) => p.email)
				.map((p) => p.type)
				.sort(),
		).toEqual(["PERIOD_CLOSED", "VERIFICATION_REQUEST"]);
		const updated = await expectBody<{
			preferences: { type: string; inApp: boolean }[];
		}>(
			await call("/notifications/preferences", {
				method: "PUT",
				headers: asAlice,
				body: {
					preferences: [
						{
							type: "EXPENSE_SPLIT",
							inApp: false,
							email: true,
							digestMode: true,
						},
					],
				},
				idempotent: true,
			}),
			n.updatePreferences,
		);
		expect(
			updated.preferences.find((p) => p.type === "EXPENSE_SPLIT"),
		).toMatchObject({
			inApp: false,
		});
		await expect(
			adminDb.notificationPreference.count({ where: { userId: alice } }),
		).resolves.toBe(10);
	});
});
