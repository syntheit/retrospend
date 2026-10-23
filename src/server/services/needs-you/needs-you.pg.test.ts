/**
 * Needs you on a real Postgres (RLS on), every item worked out by hand.
 *
 * Sofía (USD home, Flex book with USD 1,000 not planned yet):
 * - Lucía owes Sofía USD 200 and says she paid USD 50 (pending):
 *   Confirm. A claim Sofía recorded herself and a confirmed one stay out.
 * - Martín added Sofía to "Asado", her share USD 15 (pending): Review.
 * - Martín rejected his USD 30 share of Sofía's "Cabaña": Fix the split.
 * - Rent was due 3 days ago (overdue); Salary (money in, amount asked) is
 *   due today; Gym is due in 2 days; a paused overdue item stays out.
 * - Two imports wait (12 + 3 rows); a finished one stays out.
 * - Dining spent USD 30 with nothing planned, and her pending Asado share
 *   lands in Spending: two envelopes over.
 * - Her email is not verified.
 * Everything is in USD, so no rate is seeded: other pg files price ARS
 * and BRL in the same run database, and this file never moves their numbers.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { homeRouter } from "~/server/api/routers/home";
import { createCallerFactory } from "~/server/api/trpc";
import { userTransaction } from "~/server/db-tx";
import {
	addRow,
	seedUser,
	setupInput,
} from "~/server/services/envelope/__tests__/pg-fixture";
import { setupEnvelopeBook } from "~/server/services/envelope/setup.mutation";
import { peopleOverview } from "~/server/services/people/overview";
import { forUser } from "~/server/services/preview";
import { updateAppSettings } from "~/server/services/settings";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import { adminDb, createTestUser } from "~/test/pg-harness";
import type { Prisma } from "~prisma";
import { needsYou, needsYouIn } from "./index";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;
const DAY = 86_400_000;
/**
 * Splits fall today (noon UTC, the budget's UTC zone): inside the budget's
 * first month whatever the run date, never before its start.
 */
const SPLIT_DAY = new Date(
	`${new Date().toISOString().slice(0, 10)}T12:00:00.000Z`,
);
const ref = (id: string): ParticipantRef => ({
	participantType: "user",
	participantId: id,
});
const key = (id: string) => `user:${id}`;
const usd = (minor: number) => ({ minor, currency: "USD" });

async function claim(
	payer: string,
	payee: string,
	status: "PROPOSED" | "CONFIRMED",
	recordedBy = payer,
) {
	return adminDb.payment.create({
		data: {
			id: randomUUID(),
			payerType: "user",
			payerId: payer,
			payeeType: "user",
			payeeId: payee,
			amount: "50",
			currency: "USD",
			paidOn: new Date("2026-10-18"),
			recordedByType: "user",
			recordedById: recordedBy,
			status,
		},
	});
}

/** `payer` paid and created it; `other` holds `share` with `status`. */
function shared(
	title: string,
	payer: string,
	other: string,
	share: string,
	status: "PENDING" | "REJECTED" | "ACCEPTED",
) {
	return adminDb.sharedTransaction.create({
		data: {
			description: title,
			amount: share,
			currency: "USD",
			date: SPLIT_DAY,
			paidByType: "user",
			paidById: payer,
			createdByType: "user",
			createdById: payer,
			splitParticipants: {
				create: [
					{ ...ref(other), shareAmount: share, verificationStatus: status },
					{ ...ref(payer), shareAmount: "0", verificationStatus: "ACCEPTED" },
				],
			},
		},
	});
}

function recurring(
	userId: string,
	name: string,
	nextDueDate: Date,
	o: Partial<{ ask: boolean; isActive: boolean; dir: "IN" | "OUT" }> = {},
) {
	return adminDb.recurringTemplate.create({
		data: {
			userId,
			name,
			amount: "41500",
			currency: "USD",
			frequency: "MONTHLY",
			nextDueDate,
			autoPay: false,
			amountMode: o.ask ? "ASK" : "FIXED",
			direction: o.dir ?? "OUT",
			isActive: o.isActive ?? true,
		},
	});
}

function importJob(
	userId: string,
	status: "READY_FOR_REVIEW" | "REVIEWING" | "COMPLETED",
	rows: number,
	ready: Date,
) {
	return adminDb.importJob.create({
		data: {
			userId,
			status,
			type: "CSV",
			fileName: "statement.csv",
			fileSize: 100,
			fileType: "csv",
			totalTransactions: rows,
			readyForReviewAt: ready,
		},
	});
}

async function seedBudget(s: Awaited<ReturnType<typeof seedUser>>) {
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...setupInput(s),
		timeZone: "UTC",
	});
	await addRow(s.user.id, { amount: 30, categoryId: s.dining });
}

const now = new Date();
const opts = { budget: true, timeZone: "UTC", now } as const;

let sofia: Awaited<ReturnType<typeof seedUser>>;
let lucia: TestUser;
let martin: TestUser;
const ids: Record<string, string> = {};

beforeAll(async () => {
	sofia = await seedUser();
	lucia = await createTestUser();
	martin = await createTestUser();
	await adminDb.user.update({
		where: { id: lucia.user.id },
		data: { name: "Lucía" },
	});
	await adminDb.user.update({
		where: { id: martin.user.id },
		data: { name: "Martín" },
	});
	const me = sofia.user.id;
	await shared("Cena", me, lucia.user.id, "200", "ACCEPTED");
	ids.claim = (await claim(lucia.user.id, me, "PROPOSED")).id;
	await claim(lucia.user.id, me, "PROPOSED", me);
	await claim(lucia.user.id, me, "CONFIRMED");
	ids.asado = (await shared("Asado", martin.user.id, me, "15", "PENDING")).id;
	ids.cabana = (
		await shared("Cabaña", me, martin.user.id, "30", "REJECTED")
	).id;
	ids.rent = (
		await recurring(me, "Rent", new Date(now.getTime() - 3 * DAY))
	).id;
	ids.salary = (
		await recurring(me, "Salary", new Date(now.getTime()), {
			ask: true,
			dir: "IN",
		})
	).id;
	await recurring(me, "Gym", new Date(now.getTime() + 2 * DAY));
	await recurring(me, "Old", new Date(now.getTime() - 5 * DAY), {
		isActive: false,
	});
	ids.job1 = (
		await importJob(me, "READY_FOR_REVIEW", 12, new Date(now.getTime() - DAY))
	).id;
	ids.job2 = (await importJob(me, "REVIEWING", 3, new Date(now.getTime()))).id;
	await importJob(me, "COMPLETED", 40, new Date(now.getTime() - 2 * DAY));
	await seedBudget(sofia);
});

describe("needsYou on Postgres", () => {
	it("one list in urgency order, every item from its source", async () => {
		const list = await needsYou(adminDb, sofia.user.id, opts);
		expect(list.items.map((i) => i.id)).toEqual([
			`recurring.overdue:${ids.rent}`,
			`payment.confirm:${ids.claim}`,
			`split.review:${ids.asado}`,
			`split.rejected:${ids.cabana}`,
			"import.review",
			`recurring.due:${ids.salary}`,
			"budget.overspent",
			"budget.giveJob",
			"setup.verifyEmail",
		]);
		const by = Object.fromEntries(list.items.map((i) => [i.type, i]));
		expect(by["payment.confirm"]).toMatchObject({
			entity: { kind: "payment", id: ids.claim },
			people: [key(lucia.user.id)],
			amount: usd(5_000),
			date: "2026-10-18",
			actions: [
				{ entity: "payment", id: "confirm" },
				{ entity: "payment", id: "notReceived" },
			],
		});
		expect(by["split.review"]).toMatchObject({
			people: [key(martin.user.id)],
			amount: usd(1_500),
			title: "Asado",
			date: SPLIT_DAY.toISOString().slice(0, 10),
		});
		expect(by["split.rejected"]).toMatchObject({
			people: [key(martin.user.id)],
			amount: usd(3_000),
			title: "Cabaña",
		});
		expect(by["recurring.overdue"]).toMatchObject({
			amount: { minor: 4_150_000, currency: "USD" },
			attention: true,
			direction: "out",
		});
		expect(by["recurring.due"]).toMatchObject({
			direction: "in",
			askAmount: true,
		});
		expect(by["import.review"]).toMatchObject({
			entity: { kind: "importJob", id: ids.job1 },
			entityIds: [ids.job1, ids.job2],
			count: 15,
		});
		// Setup put USD 1,000 in the pool. Dining has nothing and spent USD 30;
		// the USD 15 Asado share lands
		// in Spending, the default envelope, which has nothing either.
		// Money fronted leaves the pool (budget P3, D18): Lucia's 200 (Cena)
		// and Martin's 30 (Cabaña: rejected, but the cash left), less the 15
		// Asado share that nets against what Martin owes: 1,000 - 215 = 785.
		// Proposed payments do not count yet (D8).
		expect(by["budget.giveJob"]).toMatchObject({
			amount: { minor: 78_500, currency: "USD" },
			// All of it is the starting money setup wrote.
			sources: [
				{
					kind: "STARTING_BALANCE",
					amount: { minor: 100_000, currency: "USD" },
					part: { minor: 78_500, currency: "USD" },
				},
			],
		});
		expect(by["budget.overspent"]).toMatchObject({
			amount: { minor: 4_500, currency: "USD" },
			title: null,
			count: 2,
		});
		expect(list.counts).toEqual({
			people: 3,
			activity: 3,
			budget: 2,
			setup: 1,
			total: 9,
		});
		expect(list.people[key(lucia.user.id)]).toMatchObject({
			name: "Lucía",
			onRetrospend: true,
		});
		expect(list.people[key(martin.user.id)]).toMatchObject({ name: "Martín" });
	});

	it("confirm and review are the same items the People page lists", async () => {
		const [list, people] = await Promise.all([
			needsYou(adminDb, sofia.user.id, opts),
			peopleOverview(sofia.db as never, sofia.user.id),
		]);
		const mine = list.items
			.filter((i) => i.type === "payment.confirm" || i.type === "split.review")
			.map((i) => i.entity?.id)
			.sort();
		expect(people.needs.map((n) => n.id).sort()).toEqual(mine);
	});

	it("with the budget off there are no budget items", async () => {
		const list = await needsYou(adminDb, sofia.user.id, {
			...opts,
			budget: false,
		});
		expect(list.items.some((i) => i.group === "budget")).toBe(false);
		expect(list.counts.budget).toBe(0);
	});

	it("RLS: read as Martín, Sofía's recurring, imports, claims and budget never show", async () => {
		const list = await userTransaction(adminDb, martin.user.id, (tx) =>
			needsYouIn(tx, sofia.user.id, opts),
		);
		const leaked = list.items.filter((i) =>
			["recurring", "importJob", "payment", "envelope", "book"].includes(
				i.entity?.kind ?? "",
			),
		);
		expect(leaked).toEqual([]);
		const own = await needsYou(adminDb, martin.user.id, opts);
		expect(own.items.map((i) => i.type)).toEqual([
			"setup.firstExpense",
			"setup.homeCurrency",
			"setup.verifyEmail",
			"setup.importStatement",
		]);
	});

	it("no Verify your email when the instance cannot send email", async () => {
		const own = await needsYou(adminDb, martin.user.id, {
			...opts,
			emailEnabled: false,
		});
		expect(own.items.map((i) => i.type)).toEqual([
			"setup.firstExpense",
			"setup.homeCurrency",
			"setup.importStatement",
		]);
		expect(own.counts.setup).toBe(3);
	});

	it("a share in a currency with no rate: the budget names it and shows no amounts (R14)", async () => {
		const s = await seedUser();
		await shared("Hverir", martin.user.id, s.user.id, "9000", "ACCEPTED");
		await adminDb.sharedTransaction.updateMany({
			where: { description: "Hverir" },
			data: { currency: "ISK" },
		});
		await seedBudget(s);
		const budget = (await needsYou(adminDb, s.user.id, opts)).items.filter(
			(i) => i.group === "budget",
		);
		expect(budget).toMatchObject([
			{ type: "budget.missingRate", currencies: ["ISK"], amount: null },
		]);
	});

	it("Fix the split offers Edit only where the creator may still edit", async () => {
		const { user } = await createTestUser();
		const me = user.id;
		const project = await adminDb.project.create({
			data: {
				name: "Depto",
				createdById: martin.user.id,
				primaryCurrency: "USD",
			},
		});
		await adminDb.projectParticipant.create({
			data: { projectId: project.id, ...ref(me), role: "VIEWER" },
		});
		const open = await shared("Open", me, martin.user.id, "10", "REJECTED");
		const locked = await shared("Locked", me, martin.user.id, "10", "REJECTED");
		await adminDb.sharedTransaction.update({
			where: { id: locked.id },
			data: { isLocked: true },
		});
		const viewer = await shared("Viewer", me, martin.user.id, "10", "REJECTED");
		await adminDb.sharedTransaction.update({
			where: { id: viewer.id },
			data: { projectId: project.id },
		});
		const list = await needsYou(adminDb, me, opts);
		const actions = Object.fromEntries(
			list.items
				.filter((i) => i.type === "split.rejected")
				.map((i) => [i.title, i.actions.map((a) => `${a.entity}.${a.id}`)]),
		);
		expect(actions).toEqual({
			Open: ["expense.edit"],
			Locked: ["expense.correct", "expense.open"],
			Viewer: ["expense.open"],
		});
	});

	it("a verified user with nothing waiting reads an empty list", async () => {
		const { user } = await createTestUser();
		await adminDb.user.update({
			where: { id: user.id },
			data: { emailVerified: true },
		});
		await addRow(user.id, { amount: 5 });
		const list = await needsYou(adminDb, user.id, opts);
		expect(list.items).toEqual([]);
		expect(list.counts.total).toBe(0);
	});
});

/** Counts every model call and raw query a transaction client serves. */
function counting(tx: Prisma.TransactionClient) {
	let n = 0;
	const wrap = <T extends object>(target: T): T =>
		new Proxy(target, {
			get(t, prop, receiver) {
				const v = Reflect.get(t, prop, receiver);
				if (typeof v !== "function") return v;
				return (...args: unknown[]) => {
					n += 1;
					return (v as (...a: unknown[]) => unknown).apply(t, args);
				};
			},
		});
	const proxy = new Proxy(tx, {
		get(t, prop, receiver) {
			const v = Reflect.get(t, prop, receiver);
			if (typeof prop === "string" && prop.startsWith("$query"))
				return (...args: unknown[]) => {
					n += 1;
					return (v as (...a: unknown[]) => unknown).apply(t, args);
				};
			if (v && typeof v === "object" && "findMany" in v) return wrap(v);
			return v;
		},
	});
	return { tx: proxy, count: () => n };
}

describe("needsYou query budget", () => {
	let busy: Awaited<ReturnType<typeof seedUser>>;

	beforeAll(async () => {
		busy = await seedUser();
		const me = busy.user.id;
		for (let i = 0; i < 3; i++) {
			const other = await createTestUser();
			await claim(other.user.id, me, "PROPOSED");
			await shared(`Split ${i}`, other.user.id, me, "100", "PENDING");
			await shared(`Mine ${i}`, me, other.user.id, "200", "REJECTED");
			await recurring(me, `Bill ${i}`, new Date(now.getTime() - (i + 1) * DAY));
			await importJob(me, "READY_FOR_REVIEW", 5, new Date(now.getTime() - DAY));
		}
		await seedBudget(busy);
	});

	const queries = (userId: string) =>
		userTransaction(adminDb, userId, async (tx) => {
			const c = counting(tx);
			await needsYouIn(c.tx, userId, opts);
			return c.count();
		});

	it("no per-item reads: three times the items, the same number of queries", async () => {
		const one = await queries(sofia.user.id);
		const three = await queries(busy.user.id);
		expect(three).toBe(one);
		// The budget source reads its book in a fixed set of queries, splits
		// included (budget P3) and frozen row values (P4): the count never
		// grows with the items.
		expect(one).toBeLessThanOrEqual(25);
	});

	it("p95 under 150 ms", async () => {
		await needsYou(adminDb, busy.user.id, opts);
		const runs: number[] = [];
		for (let i = 0; i < 20; i++) {
			const t = performance.now();
			await needsYou(adminDb, busy.user.id, opts);
			runs.push(performance.now() - t);
		}
		runs.sort((a, b) => a - b);
		expect(runs[18]).toBeLessThan(150);
	});
});

describe("home.needsYou procedure", () => {
	const caller = (user: { id: string }) =>
		createCallerFactory(homeRouter)({
			session: { user: { ...user, role: "USER", isActive: true } },
			db: adminDb,
			headers: new Headers({ "x-timezone": "UTC" }),
		} as never);

	it("budget items only with envelopeBudgetMode on", async () => {
		const c = caller(sofia.user);
		const off = await c.needsYou();
		expect(off.counts.budget).toBe(0);
		await adminDb.appSettings.update({
			where: { id: "app_settings_singleton" },
			data: { envelopeBudgetMode: "ALL" },
		});
		await updateAppSettings({});
		try {
			const on = await c.needsYou();
			expect(on.counts.budget).toBe(2);
			expect(on.counts.total).toBe(off.counts.total + 2);
		} finally {
			await adminDb.appSettings.update({
				where: { id: "app_settings_singleton" },
				data: { envelopeBudgetMode: "OFF" },
			});
			await updateAppSettings({});
		}
	});
});
