/**
 * expense.listV2 on a real Postgres: the union of personal expenses, shares
 * and payments, its filters, accent-blind search, cursor pages and RLS.
 * Expected values are worked out by hand from the rows below (ARS home,
 * 1000 ARS per USD).
 */
import { fromWallTime } from "@retrospend/domain/time-zone";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listActivity } from "~/server/services/expense-list";
import { listV2Input } from "~/server/services/expense-list/types";
import { adminDb, createTestUser } from "~/test/pg-harness";

const TZ = "America/Argentina/Buenos_Aires";
const day = (d: number, m = 10) =>
	fromWallTime({ year: 2026, month: m - 1, day: d }, TZ);
const NOW = new Date("2026-10-21T15:00:00Z");
const OCT = { from: "2026-10-01", to: "2026-10-31" };

let me: Awaited<ReturnType<typeof createTestUser>>;
let other: Awaited<ReturnType<typeof createTestUser>>;
let subs: string;

const list = (
	who: typeof me,
	input: Partial<ReturnType<typeof listV2Input.parse>> = {},
) => listActivity(who.db, who.user.id, listV2Input.parse(input), TZ, NOW);

beforeAll(async () => {
	me = await createTestUser();
	other = await createTestUser();
	await adminDb.user.update({
		where: { id: me.user.id },
		data: { homeCurrency: "ARS" },
	});
	await adminDb.exchangeRate.create({
		data: { date: day(1), currency: "ARS", type: "official", rate: "1000" },
	});
	subs = (
		await adminDb.category.create({
			data: { name: "Subscriptions", color: "violet", userId: me.user.id },
		})
	).id;
	const expense = (
		title: string,
		amount: string,
		currency: string,
		usd: string,
		date: Date,
		categoryId?: string,
	) => ({
		userId: me.user.id,
		title,
		amount,
		currency,
		amountInUSD: usd,
		exchangeRate: currency === "USD" ? "1" : "1000",
		pricingSource: "MANUAL",
		date,
		categoryId,
	});
	await adminDb.expense.createMany({
		data: [
			expense("Almacén Don José", "64000", "ARS", "64", day(5)),
			expense("Netflix", "12.99", "USD", "12.99", day(3), subs),
			expense("Old one", "100", "ARS", "0.1", day(10, 9)),
		],
	});
	await adminDb.sharedTransaction.create({
		data: {
			id: "pgl_tx_cena",
			description: "Cena en La Esquina",
			amount: "30000",
			currency: "ARS",
			exchangeRate: "1000",
			date: day(4),
			paidByType: "user",
			paidById: other.user.id,
			createdByType: "user",
			createdById: other.user.id,
			splitParticipants: {
				create: [
					{
						participantType: "user",
						participantId: me.user.id,
						shareAmount: "15000",
						verificationStatus: "PENDING",
					},
					{
						participantType: "user",
						participantId: other.user.id,
						shareAmount: "15000",
						verificationStatus: "ACCEPTED",
					},
				],
			},
		},
	});
	const settle = (
		id: string,
		extra: {
			amount: string;
			status: "FINALIZED" | "REJECTED";
			isOffset?: boolean;
			paymentGroupId?: string;
		},
	) => ({
		id,
		fromParticipantType: "user" as const,
		fromParticipantId: other.user.id,
		toParticipantType: "user" as const,
		toParticipantId: me.user.id,
		currency: "ARS",
		initiatedAt: day(6),
		paymentGroupId: "pgl_group",
		...extra,
	});
	await adminDb.settlement.createMany({
		data: [
			settle("pgl_s1", { amount: "10000", status: "FINALIZED" }),
			settle("pgl_s2", { amount: "5000", status: "FINALIZED" }),
			// An offset moves no cash; a rejected payment never happened.
			settle("pgl_s3", { amount: "999", status: "FINALIZED", isOffset: true }),
			settle("pgl_s4", {
				amount: "777",
				status: "REJECTED",
				paymentGroupId: "pgl_rejected",
			}),
		],
	});
});

afterAll(async () => {
	await adminDb.settlement.deleteMany({
		where: { id: { startsWith: "pgl_" } },
	});
	await adminDb.sharedTransaction.deleteMany({ where: { id: "pgl_tx_cena" } });
	await adminDb.user.deleteMany({
		where: { id: { in: [me.user.id, other.user.id] } },
	});
	await adminDb.exchangeRate.deleteMany({
		where: { date: day(1), currency: "ARS" },
	});
});

describe("expense.listV2", () => {
	it("lists October newest first: the payment, then expenses and the share", async () => {
		const r = await list(me, OCT);
		expect(r.items.map((i) => i.title || i.kind)).toEqual([
			"payment",
			"Almacén Don José",
			"Cena en La Esquina",
			"Netflix",
		]);
		expect(r.count).toBe(4);
		expect(r.today).toBe("2026-10-21");
		expect(r.homeCurrency).toBe("ARS");
		// Spent() is not on this branch yet: no footer total, never a sum of our own.
		expect(r.total).toBeNull();
	});

	it("shapes every source in minor units", async () => {
		const [payment, almacen, cena, netflix] = (await list(me, OCT)).items;
		expect(payment).toMatchObject({
			kind: "payment",
			amount: { minor: 1500000, currency: "ARS" },
			date: "2026-10-06",
			payment: {
				direction: "received",
				counterparty: other.user.name?.split(" ")[0],
			},
		});
		expect(almacen?.amount).toEqual({ minor: 6400000, currency: "ARS" });
		expect(almacen).not.toHaveProperty("home");
		// 12.99 USD at 1000 ARS per USD = ARS 12,990.00
		expect(netflix).toMatchObject({
			amount: { minor: 1299, currency: "USD" },
			home: { minor: 1299000, currency: "ARS" },
			sortKey: 1299000,
			category: { name: "Subscriptions", tone: 8 },
		});
		expect(cena).toMatchObject({
			id: "shared:pgl_tx_cena",
			amount: { minor: 3000000, currency: "ARS" },
			share: { minor: 1500000, currency: "ARS" },
			waiting: "review",
			payerName: other.user.name?.split(" ")[0],
			mine: false,
		});
		expect(cena?.people).toHaveLength(2);
	});

	it("searches across months, ignoring case and accents, and by amount", async () => {
		for (const q of [
			"almacen",
			"ALMACÉN",
			"don jose",
			"64000",
			"64.000",
			"64,000",
		])
			expect(
				(await list(me, { q })).items.map((i) => i.title),
				q,
			).toEqual(["Almacén Don José"]);
		expect((await list(me, { q: "old" })).items.map((i) => i.title)).toEqual([
			"Old one",
		]);
		expect((await list(me, { q: "100%" })).items).toEqual([]);
	});

	it("narrows by category, person, payer and kind", async () => {
		const titles = async (f: object) =>
			(await list(me, { ...OCT, ...f })).items.map((i) => i.title || i.kind);
		expect(await titles({ categoryIds: [subs] })).toEqual(["Netflix"]);
		expect(await titles({ people: [`user:${other.user.id}`] })).toEqual([
			"payment",
			"Cena en La Esquina",
		]);
		expect(await titles({ paidBy: ["me"] })).toEqual([
			"Almacén Don José",
			"Netflix",
		]);
		expect(await titles({ paidBy: [`user:${other.user.id}`] })).toEqual([
			"payment",
			"Cena en La Esquina",
		]);
		expect(await titles({ kinds: ["payment"] })).toEqual(["payment"]);
		// Money in has no rows until its table lands.
		expect(await titles({ kinds: ["in"] })).toEqual([]);
	});

	it("pages with a cursor that never repeats or skips a row", async () => {
		const p1 = await list(me, { limit: 2 });
		expect(p1.items).toHaveLength(2);
		expect(p1.count).toBe(5);
		const p2 = await list(me, { limit: 2, cursor: p1.nextCursor ?? "" });
		const p3 = await list(me, { limit: 2, cursor: p2.nextCursor ?? "" });
		expect(p2.count).toBeNull();
		expect(p3.nextCursor).toBeNull();
		const ids = [...p1.items, ...p2.items, ...p3.items].map((i) => i.id);
		expect(new Set(ids).size).toBe(5);
		expect(ids).toEqual((await list(me)).items.map((i) => i.id));
		await expect(list(me, { cursor: "bm90LWEtY3Vyc29y" })).rejects.toThrow(
			"Unknown cursor",
		);
	});

	it("shows the other side only their own rows (RLS and filters)", async () => {
		const r = await list(other, OCT);
		expect(r.items.map((i) => i.title || i.kind)).toEqual([
			"payment",
			"Cena en La Esquina",
		]);
		expect(r.items[0]?.payment?.direction).toBe("sent");
		expect(r.items[1]).toMatchObject({ mine: true, canEdit: true });
	});
});
