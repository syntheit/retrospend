/**
 * /api/v1 billing periods on Postgres, through the web's own procedures:
 * the list with its counts, the detail added up per currency, closing the
 * open period, settling only when nothing is outstanding, renaming, and who
 * may do what. Sofia owns "Flat"; Martin is a contributor; a stranger sees
 * nothing.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import {
	arsUser,
	ref,
	seedRates,
	type TestUser,
} from "../../__tests__/g3-fixtures";
import {
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

const c = contract["billing-periods"];
type Money = { minor: number; currency: string };
type Period = { id: string; label: string; status: string };

describe("/api/v1 billing periods", () => {
	useApiV1();
	let sofia: TestUser;
	let martin: TestUser;
	let stranger: TestUser;
	let asSofia: Record<string, string>;
	let asMartin: Record<string, string>;
	let asStranger: Record<string, string>;
	let flat: string;

	const post = (path: string, body: unknown, headers = asSofia) =>
		call(path, { method: "POST", headers, body, idempotent: true });
	const openPeriod = (project: string) =>
		adminDb.billingPeriod.findFirstOrThrow({
			where: { projectId: project, status: "OPEN" },
		});

	async function newProject() {
		const made = await post("/projects", {
			name: "Flat",
			primaryCurrency: "ARS",
			billingCycleLength: "MONTHLY",
		});
		const id = (await made.json()).id as string;
		await adminDb.projectParticipant.create({
			data: { projectId: id, ...ref(martin), role: "CONTRIBUTOR" },
		});
		return id;
	}

	beforeAll(async () => {
		await seedRates();
		[sofia, martin, stranger] = [await arsUser(), await arsUser(), await arsUser()];
		[asSofia, asMartin, asStranger] = [
			await asMobile(sofia.user.id),
			await asMobile(martin.user.id),
			await asMobile(stranger.user.id),
		];
		flat = await newProject();
		const period = await openPeriod(flat);
		// Rent ARS 1,000 and a USD 20 fee, both in the open period; Martin has not answered.
		for (const [description, amount, currency, categoryName] of [
			["Rent", "1000", "ARS", "Home"],
			["Fee", "20", "USD", "Home"],
		] as const) {
			const category = await adminDb.category.upsert({
				where: { id: `${sofia.user.id}-home` },
				create: {
					id: `${sofia.user.id}-home`,
					name: categoryName,
					color: "blue",
					userId: sofia.user.id,
				},
				update: {},
			});
			await adminDb.sharedTransaction.create({
				data: {
					description,
					amount,
					currency,
					date: new Date("2026-10-05"),
					paidByType: "user",
					paidById: sofia.user.id,
					createdByType: "user",
					createdById: sofia.user.id,
					projectId: flat,
					billingPeriodId: period.id,
					categoryId: category.id,
					splitParticipants: {
						create: [
							{
								...ref(martin),
								shareAmount: String(Number(amount) / 2),
								verificationStatus: "PENDING",
							},
							{
								...ref(sofia),
								shareAmount: String(Number(amount) / 2),
								verificationStatus: "ACCEPTED",
							},
						],
					},
				},
			});
		}
	});

	it("lists the periods with their counts, and only for members", async () => {
		const list = await expectBody<{
			items: (Period & {
				expenseCount: number;
				unverifiedCount: number;
				shareCount: number;
			})[];
		}>(await call(`/projects/${flat}/billing-periods`, { headers: asMartin }), c.list);
		expect(list.items).toHaveLength(1);
		expect(list.items[0]).toMatchObject({
			status: "OPEN",
			expenseCount: 2,
			unverifiedCount: 2,
			shareCount: 4,
		});
		await expectProblem(
			await call(`/projects/${flat}/billing-periods`, { headers: asStranger }),
			404,
			"not_found",
		);
	});

	it("adds the period up per currency, never across them", async () => {
		const id = (await openPeriod(flat)).id;
		const detail = await expectBody<{
			expenseCount: number;
			total: Money[];
			byCategory: { name: string; total: Money[] }[];
			byPerson: { person: { id: string }; share: Money[] }[];
		}>(await call(`/projects/${flat}/billing-periods/${id}`, { headers: asSofia }), c.get);
		expect(detail.expenseCount).toBe(2);
		expect(detail.total).toEqual([
			{ minor: 100_000, currency: "ARS" },
			{ minor: 2_000, currency: "USD" },
		]);
		expect(detail.byCategory).toMatchObject([{ name: "Home", total: detail.total }]);
		const martinShare = detail.byPerson.find((p) => p.person.id === martin.user.id);
		expect(martinShare?.share).toEqual([
			{ minor: 50_000, currency: "ARS" },
			{ minor: 1_000, currency: "USD" },
		]);
		await expectProblem(
			await call(`/projects/${flat}/billing-periods/nope`, { headers: asSofia }),
			404,
			"not_found",
		);
	});

	it("closes the open period for the owner only, and opens the next", async () => {
		await expectProblem(
			await post(`/projects/${flat}/billing-periods/close`, {}, asMartin),
			403,
			"forbidden",
		);
		await expectProblem(
			await post(`/projects/${flat}/billing-periods/close`, {}, asStranger),
			404,
			"not_found",
		);
		const key = randomUUID();
		const send = () =>
			call(`/projects/${flat}/billing-periods/close`, {
				method: "POST",
				headers: asSofia,
				body: {},
				idempotent: key,
			});
		const done = await expectBody<{ closed: Period; next: Period }>(
			await send(),
			c.closeCurrent,
		);
		expect(done.closed.status).toBe("CLOSING");
		expect(done.next.status).toBe("OPEN");
		const replay = await send();
		expect(replay.headers.get("idempotent-replayed")).toBe("true");
		expect(
			await adminDb.billingPeriod.count({ where: { projectId: flat } }),
		).toBe(2);

		// Settling waits for the unanswered shares.
		await expectProblem(
			await post(
				`/projects/${flat}/billing-periods/${done.closed.id}/settle`,
				{},
			),
			400,
			"bad_request",
		);
		expect(
			(await adminDb.billingPeriod.findUniqueOrThrow({ where: { id: done.closed.id } }))
				.status,
		).toBe("CLOSING");
	});

	it("renames a period, and settles a closed one with nothing outstanding", async () => {
		const project = await newProject();
		const open = await openPeriod(project);
		const renamed = await expectBody<Period>(
			await call(`/projects/${project}/billing-periods/${open.id}`, {
				method: "PATCH",
				headers: asSofia,
				body: { label: "October rent" },
				idempotent: true,
			}),
			c.rename,
		);
		expect(renamed.label).toBe("October rent");
		await expectProblem(
			await call(`/projects/${project}/billing-periods/${open.id}`, {
				method: "PATCH",
				headers: asMartin,
				body: { label: "Mine" },
				idempotent: true,
			}),
			403,
			"forbidden",
		);

		await expectProblem(
			await post(`/projects/${project}/billing-periods/${open.id}/settle`, {}),
			400,
			"bad_request",
		);
		await post(`/projects/${project}/billing-periods/close`, {});
		const settled = await expectBody<Period>(
			await post(`/projects/${project}/billing-periods/${open.id}/settle`, {}),
			c.settle,
		);
		expect(settled.status).toBe("SETTLED");
		await expectProblem(
			await post(`/projects/${project}/billing-periods/${open.id}/settle`, {}, asMartin),
			403,
			"forbidden",
		);
	});
});
