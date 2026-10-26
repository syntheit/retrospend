/**
 * The project writes of /api/v1 on Postgres, through the web's own
 * procedures: create with a client id, settings, members and roles, dates,
 * ownership, invite links, the rebalance preview and write, the paged
 * expense list, and who may do what. Trip: Sofia (owner), Martin (editor),
 * Lucia (viewer); a stranger sees none of it.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import {
	arsUser,
	ref,
	seedProject,
	seedRates,
	seedShare,
	type TestUser,
} from "../../__tests__/g3-fixtures";
import {
	asKey,
	asMobile,
	call,
	expectBody,
	expectProblem,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.projects;
type Settings = {
	id: string;
	name: string;
	description: string | null;
	visibility: string;
	budget: { minor: number; currency: string } | null;
	billingCycleLength: string | null;
	autoAcceptSplits: boolean;
};
type Member = {
	person: { type: string; id: string };
	role: string;
	joinedOn: string | null;
	leftOn: string | null;
};
type Link = { id: string; url: string; roleGranted: string; isActive: boolean };

describe("project writes", () => {
	let sofia: TestUser;
	let martin: TestUser;
	let lucia: TestUser;
	let stranger: TestUser;
	let asSofia: Record<string, string>;
	let asMartin: Record<string, string>;
	let asLucia: Record<string, string>;
	let asStranger: Record<string, string>;
	let trip: string;

	const send = (
		method: string,
		path: string,
		headers: Record<string, string>,
		body?: unknown,
		key?: string,
	) => call(path, { method, headers, body, idempotent: key ?? true });
	const project = (id = trip) =>
		adminDb.project.findUniqueOrThrow({ where: { id } });

	beforeAll(async () => {
		await seedRates();
		[sofia, martin, lucia, stranger] = [
			await arsUser(),
			await arsUser(),
			await arsUser(),
			await arsUser(),
		];
		[asSofia, asMartin, asLucia, asStranger] = [
			await asMobile(sofia.user.id),
			await asMobile(martin.user.id),
			await asMobile(lucia.user.id),
			await asMobile(stranger.user.id),
		];
		trip = await seedProject(sofia, [
			{ user: martin, role: "EDITOR" },
			{ user: lucia, role: "VIEWER" },
		]);
	});

	it("creates a project with a client id, replays it, and refuses the id twice", async () => {
		const id = randomUUID();
		const key = randomUUID();
		const body = {
			id,
			name: "Mendoza",
			description: "Wine trip",
			primaryCurrency: "ARS",
			budgetAmount: "250000",
			budgetCurrency: "ARS",
			billingCycleLength: "MONTHLY",
		};
		const made = await expectBody<Settings>(
			await send("POST", "/projects", asSofia, body, key),
			c.create,
			201,
		);
		expect(made).toMatchObject({
			id,
			name: "Mendoza",
			visibility: "PRIVATE",
			budget: { minor: 25_000_000, currency: "ARS" },
			billingCycleLength: "MONTHLY",
		});
		const row = await adminDb.projectParticipant.findFirstOrThrow({
			where: { projectId: id, participantId: sofia.user.id },
		});
		expect(row.role).toBe("ORGANIZER");
		expect(
			await adminDb.billingPeriod.count({ where: { projectId: id } }),
		).toBe(1);

		const replay = await send("POST", "/projects", asSofia, body, key);
		expect(replay.headers.get("idempotent-replayed")).toBe("true");
		expect(await adminDb.project.count({ where: { id } })).toBe(1);
		await expectProblem(
			await send("POST", "/projects", asMartin, body),
			409,
			"id_taken",
		);
	});

	it("changes only the fields sent, for an editor, and refuses others", async () => {
		const done = await expectBody<Settings>(
			await send("PATCH", `/projects/${trip}`, asMartin, {
				description: "Lunch money",
				autoAcceptSplits: false,
			}),
			c.update,
		);
		expect(done).toMatchObject({
			name: "Trip",
			description: "Lunch money",
			autoAcceptSplits: false,
		});
		await expectProblem(
			await send("PATCH", `/projects/${trip}`, asLucia, { name: "No" }),
			403,
			"forbidden",
		);
		await expectProblem(
			await send("PATCH", `/projects/${trip}`, asStranger, { name: "No" }),
			404,
			"not_found",
		);
		await expectProblem(
			await send("PATCH", `/projects/${trip}`, asMartin, { name: "" }),
			400,
			"validation_failed",
		);
		expect((await project()).name).toBe("Trip");
		const cleared = await expectBody<Settings>(
			await send("PATCH", `/projects/${trip}`, asSofia, { description: null }),
			c.update,
		);
		expect(cleared.description).toBeNull();
	});

	it("keeps each member's analytics switch their own", async () => {
		await expectBody(
			await send("PUT", `/projects/${trip}/analytics-exclusion`, asLucia, {
				exclude: true,
			}),
			c.setAnalyticsExclusion,
		);
		const rows = await adminDb.projectParticipant.findMany({
			where: { projectId: trip },
		});
		expect(
			rows.filter((r) => r.excludeFromAnalytics).map((r) => r.participantId),
		).toEqual([lucia.user.id]);
		await expectProblem(
			await send("PUT", `/projects/${trip}/analytics-exclusion`, asStranger, {
				exclude: true,
			}),
			404,
			"not_found",
		);
	});

	it("adds, re-roles and dates a member, previewing the dates first", async () => {
		const added = await expectBody<Member>(
			await send("POST", `/projects/${trip}/members`, asMartin, {
				person: { type: "user", id: stranger.user.id },
				role: "CONTRIBUTOR",
				joinedOn: "2026-10-01",
			}),
			c.addMember,
			201,
		);
		expect(added).toMatchObject({ role: "CONTRIBUTOR", joinedOn: "2026-10-01" });
		await expectProblem(
			await send("POST", `/projects/${trip}/members`, asMartin, {
				person: { type: "user", id: stranger.user.id },
			}),
			409,
			"conflict",
		);
		await expectProblem(
			await send("POST", `/projects/${trip}/members`, asLucia, {
				person: { type: "user", id: randomUUID() },
			}),
			403,
			"forbidden",
		);

		const path = `/projects/${trip}/members/user/${stranger.user.id}`;
		const role = await expectBody<Member>(
			await send("PUT", `${path}/role`, asMartin, { role: "VIEWER" }),
			c.setMemberRole,
		);
		expect(role.role).toBe("VIEWER");
		await expectProblem(
			await send("PUT", `${path}/role`, asMartin, { role: "ORGANIZER" }),
			403,
			"forbidden",
		);

		const dates = { joinedOn: "2026-10-03", leftOn: "2026-10-20" };
		const preview = await send("POST", `${path}/dates/preview`, asMartin, dates);
		expect(preview.status).toBe(200);
		const before = await adminDb.projectParticipant.findFirstOrThrow({
			where: { projectId: trip, participantId: stranger.user.id },
		});
		expect(before.leftOn).toBeNull();
		const set = await expectBody<Member>(
			await send("PUT", `${path}/dates`, asMartin, dates),
			c.setMemberDates,
		);
		expect(set).toMatchObject(dates);
		await expectProblem(
			await send("PUT", `${path}/dates`, asMartin, {
				joinedOn: "2026-10-25",
				leftOn: "2026-10-20",
			}),
			400,
			"bad_request",
		);

		await expectBody(
			await send("DELETE", path, asMartin),
			c.removeMember,
		);
		expect(
			await adminDb.projectParticipant.count({
				where: { projectId: trip, participantId: stranger.user.id },
			}),
		).toBe(0);
		await expectProblem(
			await send("DELETE", `/projects/${trip}/members/user/${sofia.user.id}`, asMartin),
			403,
			"forbidden",
		);
	});

	it("hands the project over only with its name, from its creator", async () => {
		const body = { newOwnerId: martin.user.id, confirmProjectName: "Trip" };
		await expectProblem(
			await send("POST", `/projects/${trip}/ownership`, asMartin, body),
			403,
			"forbidden",
		);
		await expectProblem(
			await send("POST", `/projects/${trip}/ownership`, asSofia, {
				...body,
				confirmProjectName: "Other",
			}),
			400,
			"bad_request",
		);
		expect((await project()).createdById).toBe(sofia.user.id);
		await expectBody(
			await send("POST", `/projects/${trip}/ownership`, asSofia, body),
			c.transferOwnership,
		);
		expect((await project()).createdById).toBe(martin.user.id);
		const roles = await adminDb.projectParticipant.findMany({
			where: { projectId: trip, participantId: { in: [sofia.user.id, martin.user.id] } },
		});
		expect(Object.fromEntries(roles.map((r) => [r.participantId, r.role]))).toEqual({
			[sofia.user.id]: "EDITOR",
			[martin.user.id]: "ORGANIZER",
		});
	});

	it("makes, lists, resets and revokes invite links, as secrets", async () => {
		const base = `/projects/${trip}/magic-links`;
		const key = randomUUID();
		const link = await expectBody<Link>(
			await send("POST", base, asMartin, { roleGranted: "CONTRIBUTOR" }, key),
			c.createMagicLink,
			201,
		);
		expect(link.url).toContain(`/projects/${trip}?invite=${link.id}`);
		// The link is a secret: the idempotency store keeps no copy of it.
		const replay = await send("POST", base, asMartin, { roleGranted: "CONTRIBUTOR" }, key);
		expect(replay.status).toBe(409);

		await expectProblem(
			await send("POST", base, asMartin, { roleGranted: "ORGANIZER" }),
			400,
			"validation_failed",
		);
		await expectProblem(await send("POST", base, asLucia, {}), 403, "forbidden");

		const listed = await expectBody<{ items: Link[] }>(
			await call(base, { headers: asMartin }),
			c.magicLinks,
		);
		expect(listed.items.map((l) => l.id)).toContain(link.id);
		// A read-only token cannot read the secret.
		await expectProblem(
			await call(base, { headers: await asKey(martin.user.id, ["read"]) }),
			403,
			"missing_scope",
		);
		await expectProblem(await call(base, { headers: asLucia }), 403, "forbidden");

		const fresh = await expectBody<Link>(
			await send("POST", `${base}/reset`, asMartin, { role: "CONTRIBUTOR" }),
			c.resetMagicLink,
			201,
		);
		expect(fresh.id).not.toBe(link.id);
		expect(
			(await adminDb.magicLink.findUniqueOrThrow({ where: { id: link.id } }))
				.isActive,
		).toBe(false);
		// The link is the secret: it is in no event, so not in the feed or a webhook.
		const events = await adminDb.apiEvent.findMany({
			where: { userId: martin.user.id, type: { startsWith: "project.magic_link" } },
		});
		expect(events.map((e) => e.type).sort()).toEqual([
			"project.magic_link_created",
			"project.magic_link_reset",
		]);
		for (const e of events) {
			expect(e.entityId).toBe(trip);
			expect(JSON.stringify(e, (_k, v) => (typeof v === "bigint" ? String(v) : v))).not.toContain(link.id);
			expect(JSON.stringify(e, (_k, v) => (typeof v === "bigint" ? String(v) : v))).not.toContain(fresh.id);
		}
		const feed = await call("/events", {
			headers: await asKey(martin.user.id, ["read"]),
		});
		const feedText = await feed.text();
		expect(feed.status, feedText).toBe(200);
		expect(feedText).not.toContain(link.id);
		expect(feedText).not.toContain(fresh.id);
		await expectBody(
			await send("DELETE", `${base}/${fresh.id}`, asMartin),
			c.revokeMagicLink,
		);
		await expectProblem(
			await send("DELETE", `${base}/${fresh.id}`, asStranger),
			404,
			"not_found",
		);
	});

	it("previews the rebalance without writing, then folds a member into equal splits", async () => {
		const team = await seedProject(martin, [
			{ user: sofia, role: "EDITOR" },
			{ user: lucia, role: "VIEWER" },
		]);
		// Martin and Sofia split ARS 1,000 equally; Lucia joins later.
		const expense = await adminDb.sharedTransaction.create({
			data: {
				description: "Dinner",
				amount: "1000",
				currency: "ARS",
				date: new Date("2026-10-10"),
				paidByType: "user",
				paidById: martin.user.id,
				createdByType: "user",
				createdById: martin.user.id,
				projectId: team,
				splitMode: "EQUAL",
				splitParticipants: {
					create: [
						{ ...ref(martin), shareAmount: "500", verificationStatus: "ACCEPTED" },
						{ ...ref(sofia), shareAmount: "500", verificationStatus: "ACCEPTED" },
					],
				},
			},
		});
		const path = `/projects/${team}/rebalance`;
		const person = { type: "user", id: lucia.user.id };
		const candidates = await expectBody<{ items: { id: string; eligible: boolean }[] }>(
			await call(`${path}?type=user&personId=${lucia.user.id}`, {
				headers: asMartin,
			}),
			c.rebalanceable,
		);
		expect(candidates.items).toMatchObject([{ id: expense.id, eligible: true }]);

		const shares = async () =>
			(
				await adminDb.splitParticipant.findMany({
					where: { transactionId: expense.id },
				})
			)
				.map((s) => Number(s.shareAmount))
				.sort();
		const preview = await send("POST", `${path}/preview`, asMartin, { person });
		expect(preview.status).toBe(200);
		expect(await shares()).toEqual([500, 500]);

		await expectProblem(
			await send("POST", path, asLucia, { person }),
			403,
			"forbidden",
		);
		await expectProblem(
			await send("POST", path, await asKey(martin.user.id, ["write:expenses"]), {
				person,
			}),
			403,
			"missing_scope",
		);
		const done = await expectBody<{ rebalancedCount: number; rebalancedIds: string[] }>(
			await send("POST", path, asMartin, { person }),
			c.rebalance,
		);
		expect(done).toMatchObject({ rebalancedCount: 1, rebalancedIds: [expense.id] });
		expect((await shares()).reduce((a, b) => a + b, 0)).toBe(1000);
		expect(await shares()).toHaveLength(3);
	});

	it("pages a project's expenses with a cursor and filters by period", async () => {
		const pager = await seedProject(sofia, [{ user: martin, role: "EDITOR" }]);
		for (const [title, date] of [
			["One", "2026-10-01"],
			["Two", "2026-10-02"],
			["Three", "2026-10-03"],
		] as const)
			await seedShare(ref(sofia), ref(martin), "100", "ARS", {
				projectId: pager,
				title,
				date,
			});
		const page = async (query: string, headers = asSofia) =>
			expectBody<{
				items: { title: string; amount: { minor: number }; canEdit: boolean }[];
				nextCursor: string | null;
				total: number;
			}>(await call(`/projects/${pager}/expenses?${query}`, { headers }), c.expenses);
		const first = await page("limit=2");
		expect(first.items.map((e) => e.title)).toEqual(["Three", "Two"]);
		expect(first).toMatchObject({ total: 3 });
		expect(first.items[0]).toMatchObject({ amount: { minor: 10_000 }, canEdit: true });
		const second = await page(`limit=2&cursor=${first.nextCursor}`);
		expect(second.items.map((e) => e.title)).toEqual(["One"]);
		expect(second.nextCursor).toBeNull();
		await expectProblem(
			await call(`/projects/${pager}/expenses?cursor=junk`, { headers: asSofia }),
			400,
			"bad_request",
		);
		await expectProblem(
			await call(`/projects/${pager}/expenses`, { headers: asStranger }),
			404,
			"not_found",
		);
	});

	it("deletes a project only for the person who created it, after a preview that writes nothing", async () => {
		const doomed = await seedProject(sofia, [{ user: martin, role: "EDITOR" }]);
		await seedShare(ref(sofia), ref(martin), "500", "ARS", { projectId: doomed });
		const preview = await send("POST", `/projects/${doomed}/preview`, asSofia, {});
		expect(preview.status, await preview.clone().text()).toBe(200);
		expect(await adminDb.project.count({ where: { id: doomed } })).toBe(1);
		expect(
			await adminDb.sharedTransaction.count({ where: { projectId: doomed } }),
		).toBe(1);
		// It is a money write: the expenses scope alone is not enough.
		await expectProblem(
			await send("DELETE", `/projects/${doomed}`, await asKey(sofia.user.id, ["read", "write:expenses"])),
			403,
			"missing_scope",
		);
		await expectProblem(
			await send("POST", `/projects/${doomed}/preview`, asMartin, {}),
			403,
			"forbidden",
		);
		await expectProblem(
			await send("DELETE", `/projects/${doomed}`, asMartin),
			403,
			"forbidden",
		);
		await expectProblem(
			await send("DELETE", `/projects/${doomed}`, asStranger),
			404,
			"not_found",
		);
		await expectBody(
			await send("DELETE", `/projects/${doomed}`, asSofia),
			c.delete,
		);
		expect(await adminDb.project.count({ where: { id: doomed } })).toBe(0);
	});
});
