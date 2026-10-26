/**
 * expense.listV2 on a real Postgres: the union of personal expenses, shares
 * and payments, its filters, accent-blind search, cursor pages and RLS.
 * Expected values are worked out by hand from the rows below (ARS home,
 * 1000 ARS per USD).
 */
import { fromWallTime } from "@retrospend/domain/time-zone";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listActivity } from "~/server/services/expense-list";
import { listV2Input, NO_CATEGORY } from "~/server/services/expense-list/types";
import { adminDb, createTestUser } from "~/test/pg-harness";

const TZ = "America/Argentina/Buenos_Aires";
const day = (d: number, m = 10) =>
	fromWallTime({ year: 2026, month: m - 1, day: d }, TZ);
const NOW = new Date("2026-10-21T15:00:00Z");
const OCT = { from: "2026-10-01", to: "2026-10-31" };

let me: Awaited<ReturnType<typeof createTestUser>>;
let other: Awaited<ReturnType<typeof createTestUser>>;
let mover: Awaited<ReturnType<typeof createTestUser>>;
let subs: string;

const list = (
	who: typeof me,
	input: Partial<ReturnType<typeof listV2Input.parse>> = {},
) => listActivity(who.db, who.user.id, listV2Input.parse(input), TZ, NOW);

beforeAll(async () => {
	me = await createTestUser();
	other = await createTestUser();
	mover = await createTestUser();
	await adminDb.user.updateMany({
		where: { id: { in: [me.user.id, mover.user.id] } },
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
	const header = (id: string, amount: string) => ({
		id,
		payerType: "user" as const,
		payerId: other.user.id,
		payeeType: "user" as const,
		payeeId: me.user.id,
		amount,
		currency: "ARS",
		paidOn: day(6),
		recordedByType: "user" as const,
		recordedById: other.user.id,
	});
	await adminDb.payment.createMany({
		data: [
			header("pgl_group", "15000"),
			header("pgl_rejected", "777"),
			header("pgl_forgive", "0"),
		],
	});
	const settle = (
		id: string,
		extra: {
			amount: string;
			status: "FINALIZED" | "REJECTED";
			isOffset?: boolean;
			paymentGroupId?: string;
			kind?: "PAYMENT" | "FORGIVE";
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
			// A forgiven balance moves no cash: not a payment row.
			settle("pgl_s5", {
				amount: "4000",
				status: "FINALIZED",
				kind: "FORGIVE",
				paymentGroupId: "pgl_forgive",
			}),
		],
	});
	await seedMover();
});

/**
 * The mover's August: money in, a refund, an own transfer, a starting
 * balance, two foreign rows booked at Official and Blue, a Cyrillic title,
 * and a payment inside a project the mover hides from analytics.
 */
async function seedMover() {
	const aug = (d: number) => day(d, 8);
	const row = (title: string, amount: string, date: Date, extra = {}) => ({
		userId: mover.user.id,
		title,
		amount,
		currency: "ARS",
		amountInUSD: (Number(amount) / 1000).toFixed(2),
		exchangeRate: "1000",
		pricingSource: "MANUAL",
		date,
		...extra,
	});
	const booked = (rateType: string) => ({
		currency: "USD",
		amountInUSD: "100",
		exchangeRate: "1",
		rateType,
		homeCurrency: "ARS",
		homeRate: "1000",
		homeAmount: "100000",
	});
	await adminDb.expense.createMany({
		data: [
			row("Saldo inicial", "900000", aug(1), {
				direction: "IN",
				entryKind: "STARTING_BALANCE",
			}),
			row("Sueldo", "500000", aug(2), { direction: "IN", inType: "INCOME" }),
			row("Devolución", "2000", aug(3), { direction: "IN", inType: "REFUND" }),
			row("Super", "10000", aug(4)),
			row("A mi caja", "3000", aug(5), { entryKind: "NOT_SPENDING" }),
			row("Чай", "500", aug(6)),
			row("Hotel", "100", aug(7), booked("official")),
			row("Hotel azul", "100", aug(8), booked("blue")),
		],
	});
	await adminDb.project.create({
		data: {
			id: "pgl_hidden",
			name: "Hidden trip",
			createdById: mover.user.id,
			participants: {
				create: {
					participantType: "user",
					participantId: mover.user.id,
					excludeFromAnalytics: true,
				},
			},
		},
	});
	await adminDb.payment.create({
		data: {
			id: "pgl_hidden_pay",
			payerType: "user",
			payerId: other.user.id,
			payeeType: "user",
			payeeId: mover.user.id,
			amount: "7000",
			currency: "ARS",
			paidOn: aug(9),
			recordedByType: "user",
			recordedById: other.user.id,
			status: "FINALIZED",
		},
	});
	await adminDb.settlement.create({
		data: {
			id: "pgl_s_hidden",
			fromParticipantType: "user",
			fromParticipantId: other.user.id,
			toParticipantType: "user",
			toParticipantId: mover.user.id,
			amount: "7000",
			currency: "ARS",
			status: "FINALIZED",
			initiatedAt: aug(9),
			projectId: "pgl_hidden",
			paymentGroupId: "pgl_hidden_pay",
		},
	});
}

afterAll(async () => {
	await adminDb.settlement.deleteMany({
		where: { id: { startsWith: "pgl_" } },
	});
	await adminDb.payment.deleteMany({ where: { id: { startsWith: "pgl_" } } });
	await adminDb.project.deleteMany({ where: { id: "pgl_hidden" } });
	await adminDb.sharedTransaction.deleteMany({ where: { id: "pgl_tx_cena" } });
	await adminDb.user.deleteMany({
		where: { id: { in: [me.user.id, other.user.id, mover.user.id] } },
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
		// spent(): Almacén 64,000 + Netflix 12.99 USD at 1000 (12,990) + the
		// pending share 15,000 = ARS 91,990. The payment is not spending.
		expect(r.total).toEqual({
			figure: "spent",
			value: { minor: 9199000, currency: "ARS" },
		});
		expect(r.dayTotals).toEqual({
			"2026-10-06": { minor: 0, currency: "ARS" },
			"2026-10-05": { minor: 6400000, currency: "ARS" },
			"2026-10-04": { minor: 1500000, currency: "ARS" },
			"2026-10-03": { minor: 1299000, currency: "ARS" },
		});
		expect(r.elsewhere).toBeNull();
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
		expect(await titles({ kinds: ["in"] })).toEqual([]);
		// A filter spent() cannot express has no total.
		expect((await list(me, { ...OCT, paidBy: ["me"] })).total).toBeNull();
	});

	it("lists spending with no category: the sentinel alone or beside an id", async () => {
		const titles = async (categoryIds: string[]) =>
			(await list(me, { ...OCT, categoryIds })).items.map(
				(i) => i.title || i.kind,
			);
		// Almacén and the share have no category; Netflix has one; payments never do.
		expect(await titles([NO_CATEGORY])).toEqual([
			"Almacén Don José",
			"Cena en La Esquina",
		]);
		expect(await titles([NO_CATEGORY, subs])).toEqual([
			"Almacén Don José",
			"Cena en La Esquina",
			"Netflix",
		]);
		expect(await titles([subs])).toEqual(["Netflix"]);
		// The footer counts the same rows: Almacén ARS 64,000 and your share of
		// the dinner, 15,000 of 30,000, is ARS 79,000.
		const none = await list(me, { ...OCT, categoryIds: [NO_CATEGORY] });
		expect(none.total?.value).toEqual({ minor: 7900000, currency: "ARS" });
		const both = await list(me, { ...OCT, categoryIds: [NO_CATEGORY, subs] });
		// + Netflix USD 12.99 at 1,000 ARS per USD = ARS 12,990: 91,990 in all
		expect(both.total?.value).toEqual({ minor: 9199000, currency: "ARS" });
	});

	it("leaves money in, own transfers and starting balances out of No category", async () => {
		const titles = async (categoryIds: string[]) =>
			(
				await list(mover, { from: "2026-08-01", to: "2026-08-31", categoryIds })
			).items.map((i) => i.title || i.kind);
		// Spending and the refund have no category; Sueldo, A mi caja and the
		// starting balance are not spending, and the hidden payment is not an expense.
		expect(await titles([NO_CATEGORY])).toEqual([
			"Hotel azul",
			"Hotel",
			"Чай",
			"Super",
			"Devolución",
		]);
		const r = await list(mover, {
			from: "2026-08-01",
			to: "2026-08-31",
			categoryIds: [NO_CATEGORY],
		});
		// 100,000 + 100,000 + 500 + 10,000 - 2,000 = ARS 208,500
		expect(r.total?.value).toEqual({ minor: 20850000, currency: "ARS" });
		expect(r.count).toBe(5);
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

describe("expense.listV2 entry kinds (M1, M2)", () => {
	const AUG = { from: "2026-08-01", to: "2026-08-31" };
	const titles = async (f: object = {}) =>
		(await list(mover, { ...AUG, ...f })).items.map((i) => i.title || i.kind);

	it("lists every entry but starting balances, and payments in hidden projects", async () => {
		expect(await titles()).toEqual([
			"Hotel azul",
			"Hotel",
			"Чай",
			"A mi caja",
			"Super",
			"Devolución",
			"Sueldo",
		]);
		const kinds = (await list(mover, AUG)).items.map((i) => i.kind);
		expect(kinds).toEqual([
			"expense",
			"expense",
			"expense",
			"transfer",
			"expense",
			"refund",
			"income",
		]);
	});

	it("maps each Type to its rows", async () => {
		expect(await titles({ kinds: ["expense"] })).toEqual([
			"Hotel azul",
			"Hotel",
			"Чай",
			"Super",
		]);
		expect(await titles({ kinds: ["in"] })).toEqual(["Sueldo"]);
		expect(await titles({ kinds: ["refund"] })).toEqual(["Devolución"]);
		expect(await titles({ kinds: ["transfer"] })).toEqual(["A mi caja"]);
		expect(await titles({ kinds: ["reimbursement"] })).toEqual([]);
	});

	it("totals with spent(): booked home values, refunds subtract, money in adds nothing", async () => {
		const r = await list(mover, AUG);
		// 100,000 + 100,000 (both booked) + 500 + 10,000 - 2,000 = ARS 208,500
		expect(r.total?.value).toEqual({ minor: 20850000, currency: "ARS" });
		expect(r.dayTotals?.["2026-08-04"]).toEqual({
			minor: 1000000,
			currency: "ARS",
		});
		expect(r.dayTotals?.["2026-08-03"]).toEqual({
			minor: -200000,
			currency: "ARS",
		});
		expect(r.dayTotals?.["2026-08-02"]).toEqual({ minor: 0, currency: "ARS" });
		expect(r.dayTotals?.["2026-08-05"]).toEqual({ minor: 0, currency: "ARS" });
		expect(r.count).toBe(7);
	});

	it("names the rate type only when it is not the default (ARS: Blue)", async () => {
		const [azul, hotel] = (await list(mover, AUG)).items;
		expect(hotel).toMatchObject({
			amount: { minor: 10000, currency: "USD" },
			home: { minor: 10000000, currency: "ARS" },
			rateType: "official",
		});
		expect(azul).not.toHaveProperty("rateType");
	});

	it("finds Cyrillic titles in any case (SQL and JS fold alike)", async () => {
		for (const q of ["чай", "Чай", "ЧАЙ"])
			expect(
				(await list(mover, { q })).items.map((i) => i.title),
				q,
			).toEqual(["Чай"]);
	});

	it("No category counts a share in someone else's category, as spent() does", async () => {
		const owner = await createTestUser();
		const guest = await createTestUser();
		await adminDb.user.update({
			where: { id: guest.user.id },
			data: { homeCurrency: "ARS" },
		});
		const theirs = await adminDb.category.create({
			data: { name: "Theirs", color: "blue", userId: owner.user.id },
		});
		await adminDb.sharedTransaction.create({
			data: {
				id: `pgl_tx_theirs_${guest.user.id}`,
				description: "Other's category",
				amount: "20000",
				currency: "ARS",
				exchangeRate: "1000",
				date: day(12),
				categoryId: theirs.id,
				paidByType: "user",
				paidById: owner.user.id,
				createdByType: "user",
				createdById: owner.user.id,
				splitParticipants: {
					create: [
						{
							participantType: "user",
							participantId: guest.user.id,
							shareAmount: "5000",
							verificationStatus: "ACCEPTED",
						},
						{
							participantType: "user",
							participantId: owner.user.id,
							shareAmount: "15000",
							verificationStatus: "ACCEPTED",
						},
					],
				},
			},
		});
		const r = await list(guest, { ...OCT, categoryIds: [NO_CATEGORY] });
		expect(r.items.map((i) => i.title)).toEqual(["Other's category"]);
		// The row shows no category: the creator's is not usable here (D19).
		expect(r.items[0]?.category).toBeNull();
		// The footer is the same row: the share, ARS 5,000.
		expect(r.total?.value).toEqual({ minor: 500000, currency: "ARS" });
		await adminDb.sharedTransaction.deleteMany({
			where: { id: `pgl_tx_theirs_${guest.user.id}` },
		});
		await adminDb.user.deleteMany({
			where: { id: { in: [owner.user.id, guest.user.id] } },
		});
	});

	it("says when an empty month has rows elsewhere", async () => {
		const empty = await list(mover, OCT);
		expect(empty.items).toEqual([]);
		expect(empty.elsewhere).toBe(true);
		const fresh = await createTestUser();
		expect((await list(fresh, OCT)).elsewhere).toBe(false);
		await adminDb.user.delete({ where: { id: fresh.user.id } });
	});
});

describe("expense.listV2 foreign shares", () => {
	it("a BRL share converts its exact USD value in the row and in the day total, with no USD cents in between", async () => {
		const owner = await createTestUser();
		const guest = await createTestUser();
		await adminDb.user.update({
			where: { id: guest.user.id },
			data: { homeCurrency: "ARS" },
		});
		const share = (id: string, amount: string) => ({
			id: `${id}_${guest.user.id}`,
			description: id,
			amount,
			currency: "BRL",
			exchangeRate: "5.4",
			date: day(12),
			paidByType: "user" as const,
			paidById: owner.user.id,
			createdByType: "user" as const,
			createdById: owner.user.id,
			splitParticipants: {
				create: [
					{
						participantType: "user" as const,
						participantId: guest.user.id,
						shareAmount: amount,
						verificationStatus: "ACCEPTED" as const,
					},
				],
			},
		});
		await adminDb.sharedTransaction.create({ data: share("brl_a", "123.45") });
		await adminDb.sharedTransaction.create({ data: share("brl_b", "77.77") });
		const r = await list(guest, OCT);
		// 123.45 / 5.4 = 22.861111 USD, x 1000 = ARS 22,861.11
		// 77.77 / 5.4 = 14.401852 USD, x 1000 = ARS 14,401.85
		const shares = new Map(r.items.map((i) => [i.title, i.share?.minor]));
		expect(shares.get("brl_a")).toBe(2286111);
		expect(shares.get("brl_b")).toBe(1440185);
		// Exact sum 37,262.96296, rounded once: ARS 37,262.96. Rounding each share
		// to USD cents first (22.86 + 14.40) gave ARS 37,260.00.
		expect(r.dayTotals?.["2026-10-12"]).toEqual({
			minor: 3726296,
			currency: "ARS",
		});
		expect(r.total?.value).toEqual({ minor: 3726296, currency: "ARS" });
		await adminDb.sharedTransaction.deleteMany({
			where: { id: { endsWith: guest.user.id } },
		});
		await adminDb.user.deleteMany({
			where: { id: { in: [owner.user.id, guest.user.id] } },
		});
	});

	it("rounds each row on its own and the day total once, so they can differ by a minor unit", async () => {
		const owner = await createTestUser();
		const guest = await createTestUser();
		await adminDb.user.update({
			where: { id: guest.user.id },
			data: { homeCurrency: "ARS" },
		});
		for (const id of ["brl_one", "brl_two"])
			await adminDb.sharedTransaction.create({
				data: {
					id: `${id}_${guest.user.id}`,
					description: id,
					amount: "1.00",
					currency: "BRL",
					exchangeRate: "5.4",
					date: day(12),
					paidByType: "user",
					paidById: owner.user.id,
					createdByType: "user",
					createdById: owner.user.id,
					splitParticipants: {
						create: [
							{
								participantType: "user",
								participantId: guest.user.id,
								shareAmount: "1.00",
								verificationStatus: "ACCEPTED",
							},
						],
					},
				},
			});
		const r = await list(guest, OCT);
		// 1.00 / 5.4 = 0.185185 USD x 1000 = ARS 185.185185 per share.
		// Each row rounds to 185.19, two rows read 370.38. The day total is
		// spent(): the exact 370.37037 rounded once, ARS 370.37.
		expect(r.items.map((i) => i.share?.minor)).toEqual([18519, 18519]);
		expect(r.dayTotals?.["2026-10-12"]).toEqual({
			minor: 37037,
			currency: "ARS",
		});
		await adminDb.sharedTransaction.deleteMany({
			where: { id: { endsWith: guest.user.id } },
		});
		await adminDb.user.deleteMany({
			where: { id: { in: [owner.user.id, guest.user.id] } },
		});
	});
});

describe("expense.listV2 rows the footer leaves out", () => {
	it("marks a row hidden from reports as not counted and names a rejected share, so the footer adds up", async () => {
		const owner = await createTestUser();
		const guest = await createTestUser();
		await adminDb.user.update({
			where: { id: guest.user.id },
			data: { homeCurrency: "ARS" },
		});
		const food = await adminDb.category.create({
			data: { name: "Food", color: "blue", userId: guest.user.id },
		});
		const row = (title: string, amount: string, hidden: boolean) => ({
			userId: guest.user.id,
			title,
			amount,
			currency: "ARS",
			amountInUSD: String(Number(amount) / 1000),
			exchangeRate: "1000",
			pricingSource: "MANUAL" as const,
			date: day(14),
			categoryId: food.id,
			excludeFromAnalytics: hidden,
		});
		await adminDb.expense.createMany({
			data: [row("Counted", "1000", false), row("Hidden", "500", true)],
		});
		await adminDb.sharedTransaction.create({
			data: {
				id: `pgl_rejected_${guest.user.id}`,
				description: "Declined split",
				amount: "700",
				currency: "ARS",
				exchangeRate: "1000",
				date: day(14),
				paidByType: "user",
				paidById: owner.user.id,
				createdByType: "user",
				createdById: owner.user.id,
				splitParticipants: {
					create: [
						{
							participantType: "user",
							participantId: guest.user.id,
							shareAmount: "350",
							verificationStatus: "REJECTED",
						},
						{
							participantType: "user",
							participantId: owner.user.id,
							shareAmount: "350",
							verificationStatus: "ACCEPTED",
						},
					],
				},
			},
		});
		const byCategory = await list(guest, { ...OCT, categoryIds: [food.id] });
		const all = await list(guest, OCT);
		for (const r of [byCategory, all]) {
			// Only "Counted" is in the footer: ARS 1,000.
			expect(r.total?.value).toEqual({ minor: 100000, currency: "ARS" });
			expect(r.dayTotals?.["2026-10-14"]).toEqual({
				minor: 100000,
				currency: "ARS",
			});
			const flags = new Map(
				r.items.map((i) => [i.title, [i.notCounted, i.waiting]] as const),
			);
			expect(flags.get("Counted")).toEqual([undefined, undefined]);
			expect(flags.get("Hidden")).toEqual([true, undefined]);
		}
		expect(byCategory.items.map((i) => i.title).sort()).toEqual([
			"Counted",
			"Hidden",
		]);
		expect(all.items.find((i) => i.title === "Declined split")?.waiting).toBe(
			"rejected",
		);
		await adminDb.sharedTransaction.deleteMany({
			where: { id: `pgl_rejected_${guest.user.id}` },
		});
		await adminDb.user.deleteMany({
			where: { id: { in: [owner.user.id, guest.user.id] } },
		});
	});

	it("says an amortized purchase is spread and an income-category expense is not counted, so the footer is the counted rows plus the parts", async () => {
		const u = await createTestUser();
		await adminDb.user.update({
			where: { id: u.user.id },
			data: { homeCurrency: "ARS" },
		});
		const [food, salary] = await Promise.all([
			adminDb.category.create({
				data: { name: "Food", color: "blue", userId: u.user.id },
			}),
			adminDb.category.create({
				data: {
					name: "Salary",
					color: "violet",
					userId: u.user.id,
					kind: "INCOME",
				},
			}),
		]);
		const row = (
			title: string,
			amount: string,
			date: Date,
			extra: object = {},
		) => ({
			userId: u.user.id,
			title,
			amount,
			currency: "ARS",
			amountInUSD: String(Number(amount) / 1000),
			exchangeRate: "1000",
			pricingSource: "MANUAL" as const,
			date,
			...extra,
		});
		// Phone: ARS 3,000 over three months. The parent is listed; its three
		// parts of ARS 1,000 (Oct 14, Nov 14, Dec 14) are hidden and counted.
		const phone = await adminDb.expense.create({
			data: row("Phone", "3000", day(14), {
				isAmortizedParent: true,
				categoryId: food.id,
			}),
		});
		await adminDb.expense.createMany({
			data: [10, 11, 12].map((m) =>
				row("Phone", "1000", day(14, m), {
					isAmortizedChild: true,
					parentId: phone.id,
					categoryId: food.id,
				}),
			),
		});
		await adminDb.expense.createMany({
			data: [
				row("Groceries", "1000", day(14), { categoryId: food.id }),
				row("Filed as income", "700", day(14), { categoryId: salary.id }),
			],
		});

		const oct = await list(u, OCT);
		const byTitle = new Map(oct.items.map((i) => [i.title, i] as const));
		expect(oct.items.map((i) => i.title).sort()).toEqual([
			"Filed as income",
			"Groceries",
			"Phone",
		]);
		expect(byTitle.get("Groceries")).not.toHaveProperty("notCounted");
		expect(byTitle.get("Groceries")).not.toHaveProperty("spread");
		// Counted, spread over time: never "Not counted".
		expect(byTitle.get("Phone")?.spread).toEqual({ months: 3 });
		expect(byTitle.get("Phone")).not.toHaveProperty("notCounted");
		// spent() skips a row filed under an income category.
		expect(byTitle.get("Filed as income")?.notCounted).toBe(true);
		expect(byTitle.get("Filed as income")).not.toHaveProperty("spread");

		// Rows with no marker add up to ARS 1,000 (Groceries). The footer also
		// holds October's part of the Phone, ARS 1,000, which the parent row
		// names. Nothing else is in it: the 700 and the parent's 3,000 are not.
		const counted = oct.items
			.filter((i) => !i.notCounted && !i.spread && i.waiting !== "rejected")
			.reduce((sum, i) => sum + i.amount.minor, 0);
		const octoberPart = 100000;
		expect(counted).toBe(100000);
		expect(oct.total?.value.minor).toBe(counted + octoberPart);
		expect(oct.total?.value).toEqual({ minor: 200000, currency: "ARS" });
		expect(oct.dayTotals?.["2026-10-14"]).toEqual({
			minor: 200000,
			currency: "ARS",
		});

		// November lists nothing of the Phone, yet its second part is spent then.
		const nov = await list(u, { from: "2026-11-01", to: "2026-11-30" });
		expect(nov.items).toEqual([]);
		expect(nov.total?.value).toEqual({ minor: 100000, currency: "ARS" });
		await adminDb.user.deleteMany({ where: { id: u.user.id } });
	});
});
