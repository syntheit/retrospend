/**
 * The project summary and its figures on Postgres, through RLS, with the
 * hand-derived trip (trip-fixture.ts). In minor units:
 *
 * | BRL  | Paid  | Share | Received | Sent | Balance |
 * |------|-------|-------|----------|------|---------|
 * | Ana  | 36000 | 16000 | 4000     | 0    | 16000   |
 * | Ben  | 9000  | 16000 | 0        | 4000 | -3000   |
 * | Cam  | 0     | 10000 | 0        | 0    | -10000  |
 * | Sam  | 0     | 3000  | 0        | 0    | -3000   |
 *
 * USD: Ana share 2000, balance -2000; Cam paid 5000, share 3000, balance 2000.
 * The rejected USD 5 payment never counts.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFigures } from "~/server/figures/read";
import {
	anonymousCaller,
	callerFor,
	seedGuest,
	seedTrip,
	type Trip,
} from "./trip-fixture";

vi.mock("~/server/mailer", () => ({ sendEmail: vi.fn(async () => {}) }));

let trip: Trip;
let key: Record<"A" | "B" | "C" | "S", string>;

beforeAll(async () => {
	trip = await seedTrip();
	const { A, B, C, S } = trip.refs;
	const k = (r: { type: string; id: string }) => `${r.type}:${r.id}`;
	key = { A: k(A), B: k(B), C: k(C), S: k(S) };
});

const brl = (minor: number) => ({ minor, currency: "BRL" });
const usd = (minor: number) => ({ minor, currency: "USD" });

describe("project.summary", () => {
	it("gives the group total and every member's lines", async () => {
		const s = await callerFor(trip.cam.user).summary({
			projectId: trip.project.id,
		});
		expect(s.total).toEqual([brl(45000), usd(5000)]);
		expect(s.balancesAddUp).toBe(true);
		const rows = Object.fromEntries(
			s.members.map((m) => [
				m.name,
				m.lines.map((l) => [
					l.currency,
					l.paid.minor,
					l.share.minor,
					l.received.minor,
					l.sent.minor,
					l.balance.minor,
				]),
			]),
		);
		expect(rows).toEqual({
			Ana: [
				["BRL", 36000, 16000, 4000, 0, 16000],
				["USD", 0, 2000, 0, 0, -2000],
			],
			Ben: [["BRL", 9000, 16000, 0, 4000, -3000]],
			Cam: [
				["BRL", 0, 10000, 0, 0, -10000],
				["USD", 5000, 3000, 0, 0, 2000],
			],
			Sam: [["BRL", 0, 3000, 0, 0, -3000]],
		});
		expect(
			s.members.map((m) => [m.name, m.role, m.isMember, m.joinedOn]),
		).toEqual([
			["Ana", "ORGANIZER", true, null],
			["Ben", "EDITOR", true, null],
			["Cam", "CONTRIBUTOR", true, null],
			["Sam", "CONTRIBUTOR", true, null],
		]);
	});

	it("lists who pays whom with the fewest transfers", async () => {
		const s = await callerFor(trip.ana.user).summary({
			projectId: trip.project.id,
		});
		expect(
			s.transfers.map((t) => [t.from.name, t.to.name, t.amount]).sort(),
		).toEqual(
			[
				["Ben", "Ana", brl(3000)],
				["Cam", "Ana", brl(10000)],
				["Sam", "Ana", brl(3000)],
				["Ana", "Cam", usd(2000)],
			].sort(),
		);
	});

	it("keeps today's numbers: Paid, Share and Balance match participantBalances", async () => {
		const s = await callerFor(trip.ana.user).summary({
			projectId: trip.project.id,
		});
		const today = await callerFor(trip.ana.user).participantBalances({
			projectId: trip.project.id,
		});
		for (const b of today.balances) {
			const k = `${b.participant.participantType}:${b.participant.participantId}`;
			const line = s.members
				.find((m) => m.key === k)
				?.lines.find((l) => l.currency === b.currency);
			expect([
				line?.paid.minor,
				line?.share.minor,
				line?.balance.minor,
			]).toEqual([
				Math.round(b.totalPaid * 100),
				Math.round(b.fairShare * 100),
				Math.round(b.netBalance * 100),
			]);
		}
	});

	it("serves a guest of the project and refuses an outsider", async () => {
		const { token } = await seedGuest(trip, "Gia");
		const s = await anonymousCaller({ "x-guest-token": token }).summary({
			projectId: trip.project.id,
		});
		expect(s.total).toEqual([brl(45000), usd(5000)]);
		expect(s.members.find((m) => m.name === "Gia")?.lines).toEqual([]);
		await expect(
			callerFor(trip.outsider.user).summary({ projectId: trip.project.id }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("figure project.total", () => {
	it("reads per currency, never one cross-currency sum", async () => {
		const r = await readFigures(trip.ben.user.id, ["project.total"], {
			projectId: trip.project.id,
		});
		expect(r.get("project.total")).toEqual([brl(45000), usd(5000)]);
	});

	it("shows an outsider nothing (RLS)", async () => {
		const r = await readFigures(trip.outsider.user.id, ["project.total"], {
			projectId: trip.project.id,
		});
		expect(r.get("project.total")).toEqual([]);
	});
});

const member = async (id: string, personId: string) =>
	readFigures(trip.ana.user.id, [id], { projectId: trip.project.id, personId });

describe("figure project.member.paid", () => {
	it("is what they paid, per currency", async () => {
		expect(
			(await member("project.member.paid", key.A)).get("project.member.paid"),
		).toEqual([brl(36000), usd(0)]);
	});
});

describe("figure project.member.share", () => {
	it("is their shares, per currency", async () => {
		expect(
			(await member("project.member.share", key.C)).get("project.member.share"),
		).toEqual([brl(10000), usd(3000)]);
	});
});

describe("figure project.member.received", () => {
	it("counts payments to them, not the rejected one", async () => {
		expect(
			(await member("project.member.received", key.A)).get(
				"project.member.received",
			),
		).toEqual([brl(4000), usd(0)]);
		expect(
			(await member("project.member.received", key.C)).get(
				"project.member.received",
			),
		).toEqual([brl(0), usd(0)]);
	});
});

describe("figure project.member.sent", () => {
	it("counts payments from them", async () => {
		expect(
			(await member("project.member.sent", key.B)).get("project.member.sent"),
		).toEqual([brl(4000)]);
	});
});

describe("figure project.member.balance", () => {
	it("is Paid - Share - Received + Sent, and adds up to zero (I9)", async () => {
		const sums = new Map<string, number>();
		for (const k of [key.A, key.B, key.C, key.S]) {
			const r = (await member("project.member.balance", k)).get(
				"project.member.balance",
			);
			for (const m of r ?? [])
				sums.set(m.currency, (sums.get(m.currency) ?? 0) + m.minor);
		}
		expect(
			(await member("project.member.balance", key.S)).get(
				"project.member.balance",
			),
		).toEqual([brl(-3000)]);
		expect(Object.fromEntries(sums)).toEqual({ BRL: 0, USD: 0 });
	});

	it("is empty for someone not on the ledger", async () => {
		expect(
			(
				await member("project.member.balance", `user:${trip.outsider.user.id}`)
			).get("project.member.balance"),
		).toEqual([]);
	});
});
