/**
 * The project figures narrowed to one billing period, on the hand-derived
 * trip (trip-fixture.ts) with its expenses split over two periods:
 *
 * | Period | Expenses                                   |
 * |--------|--------------------------------------------|
 * | P1     | Hotel BRL 300 (Ana paid), Boat USD 50 (Cam) |
 * | P2     | Car BRL 90 (Ben paid), Dinner BRL 60 (Ana)  |
 *
 * P1 shares: Ana BRL 100 and USD 20, Ben BRL 100, Cam BRL 100 and USD 30.
 * P2 shares: Ana 30 + 30, Ben 30 + 30, Sam 30 (BRL). Ben's BRL 40 payment
 * is recorded against no period, so a period's balances leave it out:
 * P2 balances are Paid minus Share only: Ana 60 - 60 = 0, Ben 90 - 60 = 30,
 * Sam -30. Without a period nothing changes.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFigures } from "~/server/figures/read";
import { adminDb } from "~/test/pg-harness";
import { seedTrip, type Trip } from "./trip-fixture";

vi.mock("~/server/mailer", () => ({ sendEmail: vi.fn(async () => {}) }));

let trip: Trip;
let p1: string;
let p2: string;
let key: Record<"A" | "B" | "C" | "S", string>;

beforeAll(async () => {
	trip = await seedTrip();
	const { A, B, C, S } = trip.refs;
	const k = (r: { type: string; id: string }) => `${r.type}:${r.id}`;
	key = { A: k(A), B: k(B), C: k(C), S: k(S) };
	const period = (label: string, start: string, end: string) =>
		adminDb.billingPeriod.create({
			data: {
				projectId: trip.project.id,
				label,
				startDate: new Date(start),
				endDate: new Date(end),
			},
		});
	p1 = (await period("P1", "2026-10-01", "2026-10-10")).id;
	p2 = (await period("P2", "2026-10-11", "2026-10-31")).id;
	const { hotel, boat, car, dinner } = trip.expenses;
	for (const [id, billingPeriodId] of [
		[hotel.id, p1],
		[boat.id, p1],
		[car.id, p2],
		[dinner.id, p2],
	] as const)
		await adminDb.sharedTransaction.update({
			where: { id },
			data: { billingPeriodId },
		});
});

const brl = (minor: number) => ({ minor, currency: "BRL" });
const usd = (minor: number) => ({ minor, currency: "USD" });

const read = async (
	id: string,
	narrowing: { periodId?: string; personId?: string },
	user = trip.ana,
) =>
	(
		await readFigures(user.user.id, [id], {
			projectId: trip.project.id,
			...narrowing,
		})
	).get(id);

describe("project figures narrowed by billing period", () => {
	it("totals one period per currency", async () => {
		expect(await read("project.total", { periodId: p1 })).toEqual([
			brl(30000),
			usd(5000),
		]);
		expect(await read("project.total", { periodId: p2 })).toEqual([brl(15000)]);
	});

	it("keeps the whole project's total when no period is named", async () => {
		expect(await read("project.total", {})).toEqual([brl(45000), usd(5000)]);
	});

	it("gives a member's share and paid in that period only", async () => {
		expect(
			await read("project.member.share", { periodId: p1, personId: key.C }),
		).toEqual([brl(10000), usd(3000)]);
		expect(
			await read("project.member.paid", { periodId: p1, personId: key.A }),
		).toEqual([brl(30000), usd(0)]);
		expect(
			await read("project.member.share", { periodId: p2, personId: key.S }),
		).toEqual([brl(3000)]);
	});

	it("leaves a payment recorded against no period out of a period's balance", async () => {
		const balance = (personId: string) =>
			read("project.member.balance", { periodId: p2, personId });
		expect(await balance(key.A)).toEqual([brl(0)]);
		expect(await balance(key.B)).toEqual([brl(3000)]);
		expect(await balance(key.S)).toEqual([brl(-3000)]);
		// Over the whole project Ben's payment counts: 9000 - 16000 + 4000.
		expect(await read("project.member.balance", { personId: key.B })).toEqual([
			brl(-3000),
		]);
	});

	it("reads nothing for a period of another project, and nothing for an outsider", async () => {
		const other = await seedTrip();
		const otherPeriod = await adminDb.billingPeriod.create({
			data: {
				projectId: other.project.id,
				label: "Elsewhere",
				startDate: new Date("2026-10-01"),
				endDate: new Date("2026-10-31"),
			},
		});
		expect(await read("project.total", { periodId: otherPeriod.id })).toEqual(
			[],
		);
		expect(
			await read("project.total", { periodId: p1 }, trip.outsider),
		).toEqual([]);
	});
});
