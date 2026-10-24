/**
 * /api/v1/projects on Postgres: the list, page, members, summary and Settle
 * all that the web reads and writes, with previews that equal the result,
 * the "balances moved" conflict, undo, idempotent replay and roles. Trip:
 * Sofia (organizer), Martin (editor) and Lucia (viewer). Martin paid ARS
 * 3,000 that Sofia owes; Sofia paid ARS 900 that Lucia owes. Balance
 * (Paid - Share - Received + Sent): Martin +3,000, Sofia -2,100, Lucia -900.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import {
	ars,
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
	useApiV1,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.projects;
type Money = { minor: number; currency: string };
type Preview = { changes: { id: string; delta: Money }[] };
type Plan = {
	planned: { person: string; currency: string; minor: number }[];
	skipped: unknown[];
};
type Settled = {
	settled: {
		person: string;
		direction: string;
		amount: Money;
		status: string;
		paymentId: string;
	}[];
	skipped: unknown[];
	undo: string;
};

describe("/api/v1/projects", () => {
	useApiV1();
	let sofia: TestUser;
	let martin: TestUser;
	let lucia: TestUser;
	let stranger: TestUser;
	let as: Record<string, string>;
	let asLucia: Record<string, string>;
	let asStranger: Record<string, string>;
	let trip: string;

	const get = (path: string, headers = as) => call(path, { headers });
	const post = (path: string, body: unknown, headers = as, key?: string) =>
		call(path, { method: "POST", headers, body, idempotent: key ?? true });
	const owed = async () => {
		const list = await expectBody<{
			owedToYou: Money | null;
			youOwe: Money | null;
		}>(await get("/people"), contract.people.list);
		return {
			owedToYou: list.owedToYou?.minor ?? 0,
			youOwe: list.youOwe?.minor ?? 0,
		};
	};
	const paymentCount = () =>
		adminDb.payment.count({
			where: { settlements: { some: { projectId: trip } } },
		});

	beforeAll(async () => {
		await seedRates();
		[sofia, martin, lucia, stranger] = [
			await arsUser(),
			await arsUser(),
			await arsUser(),
			await arsUser(),
		];
		as = await asMobile(sofia.user.id);
		asLucia = await asMobile(lucia.user.id);
		asStranger = await asMobile(stranger.user.id);
		trip = await seedProject(sofia, [
			{ user: martin, role: "EDITOR" },
			{ user: lucia, role: "VIEWER" },
		]);
		await adminDb.projectParticipant.updateMany({
			where: { projectId: trip, participantId: lucia.user.id },
			data: { joinedOn: new Date("2026-10-20") },
		});
		await seedShare(ref(martin), ref(sofia), "3000", "ARS", {
			projectId: trip,
			title: "Cabin",
			date: "2026-10-05",
		});
		await seedShare(ref(sofia), ref(lucia), "900", "ARS", {
			projectId: trip,
			title: "Groceries",
			date: "2026-10-06",
		});
	});

	it("lists your projects with their figures, and only yours", async () => {
		const mine = await expectBody<{
			items: {
				id: string;
				total: Money[];
				myShare: Money[];
				myBalance: Money[];
				myRole: string;
			}[];
			nextCursor: null;
		}>(await get("/projects"), c.list);
		expect(mine.items).toHaveLength(1);
		expect(mine.items[0]).toMatchObject({
			id: trip,
			myRole: "ORGANIZER",
			total: [ars(390_000)],
			myShare: [ars(300_000)],
			myBalance: [ars(-210_000)],
		});
		const none = await expectBody<{ items: unknown[] }>(
			await get("/projects", asStranger),
			c.list,
		);
		expect(none.items).toEqual([]);
	});

	it("reads the page for a member and refuses everyone else", async () => {
		const page = await expectBody<{
			members: {
				participantId: string;
				role: string;
				isMe: boolean;
				withMe: Money[];
			}[];
			expenses: { title: string; share: Money | null }[];
			total: Money[];
		}>(await get(`/projects/${trip}`), c.get);
		expect(page.total).toEqual([ars(390_000)]);
		expect(page.expenses.map((e) => e.title).sort()).toEqual([
			"Cabin",
			"Groceries",
		]);
		expect(page.members[0]).toMatchObject({
			participantId: sofia.user.id,
			isMe: true,
		});
		expect(
			page.members.find((m) => m.participantId === martin.user.id)?.withMe,
		).toEqual([ars(-300_000)]);
		await expectProblem(
			await get(`/projects/${trip}`, asStranger),
			404,
			"not_found",
		);
		await expectBody(await get(`/projects/${trip}`, asLucia), c.get);
	});

	it("lists who was a member on a day", async () => {
		const day = async (date?: string) =>
			(
				await expectBody<{ items: { participantId: string; name: string }[] }>(
					await get(`/projects/${trip}/members${date ? `?date=${date}` : ""}`),
					c.members,
				)
			).items.map((m) => m.participantId);
		expect(await day("2026-10-10")).toHaveLength(2);
		expect(await day("2026-10-25")).toContain(lucia.user.id);
		await expectProblem(
			await get(`/projects/${trip}/members`, asStranger),
			404,
			"not_found",
		);
	});

	it("reads the summary, which adds up to zero", async () => {
		const summary = await expectBody<{
			balancesAddUp: boolean;
			total: Money[];
			members: {
				id: string;
				lines: { balance: Money; paid: Money; share: Money }[];
			}[];
			transfers: { from: { id: string }; to: { id: string }; amount: Money }[];
		}>(await get(`/projects/${trip}/summary`), c.summary);
		expect(summary.balancesAddUp).toBe(true);
		const balance = (id: string) =>
			summary.members.find((m) => m.id === id)?.lines[0]?.balance;
		expect(balance(martin.user.id)).toEqual(ars(300_000));
		expect(balance(sofia.user.id)).toEqual(ars(-210_000));
		expect(balance(lucia.user.id)).toEqual(ars(-90_000));
		expect(summary.transfers.reduce((s, t) => s + t.amount.minor, 0)).toBe(
			300_000,
		);
		await expectProblem(
			await get(`/projects/${trip}/summary`, asStranger),
			404,
			"not_found",
		);
	});

	it("plans Settle all, and only for someone who may record it", async () => {
		const plan = await expectBody<Plan>(
			await get(`/projects/${trip}/settle-all/plan`),
			c.settleAllPlan,
		);
		expect(plan.planned).toEqual([
			{ person: `user:${martin.user.id}`, currency: "ARS", minor: -300_000 },
			{ person: `user:${lucia.user.id}`, currency: "ARS", minor: 90_000 },
		]);
		await expectProblem(
			await get(`/projects/${trip}/settle-all/plan`, asLucia),
			403,
			"forbidden",
		);
		await expectProblem(
			await get(`/projects/${trip}/settle-all/plan`, asStranger),
			404,
			"not_found",
		);
	});

	it("previews Settle all, records it with the same effect, and undoes it", async () => {
		const before = await owed();
		const plan = await expectBody<Plan>(
			await get(`/projects/${trip}/settle-all/plan`),
			c.settleAllPlan,
		);
		const body = { expect: plan.planned };
		const preview = await expectBody<Preview>(
			await post(`/projects/${trip}/settle-all/preview`, body),
			c.previewSettleAll,
		);
		const change = (id: string) =>
			preview.changes.find((x) => x.id === id)?.delta.minor ?? 0;
		expect(change("owed.youOwe")).toBe(-300_000);
		expect(change("owed.owedToYou")).toBe(-90_000);
		await expect(paymentCount()).resolves.toBe(0);

		const key = randomUUID();
		const done = await expectBody<Settled>(
			await post(`/projects/${trip}/settle-all`, body, as, key),
			c.settleAll,
			201,
		);
		expect(done.settled.map((l) => [l.direction, l.amount, l.status])).toEqual([
			["outgoing", ars(300_000), "PROPOSED"],
			["incoming", ars(90_000), "FINALIZED"],
		]);
		const after = await owed();
		expect(after.youOwe).toBe(before.youOwe + change("owed.youOwe"));
		expect(after.owedToYou).toBe(before.owedToYou + change("owed.owedToYou"));

		const again = await post(`/projects/${trip}/settle-all`, body, as, key);
		expect(again.headers.get("idempotent-replayed")).toBe("true");
		expect(await again.json()).toEqual(done);
		await expect(paymentCount()).resolves.toBe(2);

		// The token is for this project only.
		const other = await seedProject(sofia, []);
		await expectProblem(
			await post(`/projects/${other}/settle-all/undo`, { token: done.undo }),
			400,
			"bad_request",
		);

		const undoPreview = await expectBody<Preview>(
			await post(`/projects/${trip}/settle-all/undo/preview`, {
				token: done.undo,
			}),
			c.previewUndoSettleAll,
		);
		const undoChange = (id: string) =>
			undoPreview.changes.find((x) => x.id === id)?.delta.minor ?? 0;
		expect(undoChange("owed.youOwe")).toBe(300_000);
		await expect(paymentCount()).resolves.toBe(2);
		const undone = await expectBody<{ undone: number; redo: null }>(
			await post(`/projects/${trip}/settle-all/undo`, { token: done.undo }),
			c.undoSettleAll,
		);
		expect(undone).toEqual({ undone: 2, redo: null });
		await expect(paymentCount()).resolves.toBe(0);
		expect(await owed()).toEqual(before);
	});

	it("refuses a Settle all whose balances moved since the plan", async () => {
		const plan = await expectBody<Plan>(
			await get(`/projects/${trip}/settle-all/plan`),
			c.settleAllPlan,
		);
		await seedShare(ref(martin), ref(sofia), "50", "ARS", { projectId: trip });
		await expectProblem(
			await post(`/projects/${trip}/settle-all`, { expect: plan.planned }),
			409,
			"conflict",
		);
		await expectProblem(
			await post(`/projects/${trip}/settle-all/preview`, {
				expect: plan.planned,
			}),
			409,
			"conflict",
		);
		await expect(paymentCount()).resolves.toBe(0);
		// Without `expect` it records what is open now.
		const done = await expectBody<Settled>(
			await post(`/projects/${trip}/settle-all`, {}),
			c.settleAll,
			201,
		);
		expect(done.settled[0]?.amount).toEqual(ars(305_000));
		await expectBody(
			await post(`/projects/${trip}/settle-all/undo`, { token: done.undo }),
			c.undoSettleAll,
		);
	});

	it("keeps Settle all to those with the Contributor role and a money scope", async () => {
		for (const headers of [asLucia, asStranger]) {
			const want = headers === asLucia ? 403 : 404;
			const code = headers === asLucia ? "forbidden" : "not_found";
			await expectProblem(
				await post(`/projects/${trip}/settle-all`, {}, headers),
				want,
				code,
			);
			await expectProblem(
				await post(`/projects/${trip}/settle-all/preview`, {}, headers),
				want,
				code,
			);
		}
		const expensesOnly = await asKey(sofia.user.id, ["write:expenses", "read"]);
		await expectProblem(
			await post(`/projects/${trip}/settle-all`, {}, expensesOnly),
			403,
			"missing_scope",
		);
		await expect(paymentCount()).resolves.toBe(0);
	});
});
