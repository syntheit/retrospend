/**
 * Auto-finalize on real Postgres, through userTransaction and RLS as the
 * payee. Fixture (ARS home, Blue rates ARS 1,355 and BRL 5 per USD, so
 * BRL 1 = ARS 271): the payer owes ARS 10,000 outside projects and BRL 100
 * in a trip, which is ARS 10,000 + 27,100 = ARS 37,100.
 *
 * Every payment is recorded through payment.record, then its rows are aged
 * against a fixed past `NOW`, so a payment another test file left in the
 * same database is never stale for these sweeps.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	arsUser,
	ref,
	seedProject,
	seedRates,
	seedShare,
	type TestUser,
} from "~/server/api/v1/__tests__/g3-fixtures";
import { readEventFeed } from "~/server/services/events/feed";
import { forUser } from "~/server/services/preview";
import { computeBalance } from "~/server/services/shared-expenses/balance";
import { fanOutEvents } from "~/server/services/webhooks/worker";
import { adminDb } from "~/test/pg-harness";
import {
	finalizeStaleProposedPayments,
	sweepStalePayments,
} from "./auto-finalize";
import { confirmPayment, unconfirmPayment } from "./confirm.mutation";
import { applyPayment } from "./procedures";
import { removeRecordedPayment } from "./reverse.mutation";

const NOW = new Date("2020-01-15T12:00:00.000Z");
const DAY = 86_400_000;
const NONE = {
	finalized: 0,
	overClaimed: 0,
	raced: 0,
	reopened: 0,
	failed: 0,
};

interface Pair {
	payer: TestUser;
	payee: TestUser;
	shares: string[];
}

/** The payer owes the payee ARS 10,000 and, with `withTrip`, BRL 100 in a trip. */
async function pair(withTrip = true): Promise<Pair> {
	const [payer, payee] = [await arsUser(), await arsUser()];
	const a = await seedShare(ref(payee), ref(payer), "10000", "ARS");
	if (!withTrip) return { payer, payee, shares: [a.id] };
	const trip = await seedProject(payee, [{ user: payer, role: "EDITOR" }]);
	const b = await seedShare(ref(payee), ref(payer), "100", "BRL", {
		projectId: trip,
		date: "2026-10-09",
	});
	return { payer, payee, shares: [a.id, b.id] };
}

/** The payer's payment of `amount` ARS, aged `ageMs` at NOW; returns its id. */
async function pay(p: Pair, amount: string, ageMs = 8 * DAY) {
	const { value } = await applyPayment(p.payer.db, p.payer.user.id, {
		person: ref(p.payee),
		direction: "outgoing",
		currency: "ARS",
		amount,
	});
	if (!value.recorded) throw new Error("not recorded");
	await age(value.paymentId, ageMs);
	return value.paymentId;
}

const age = (paymentId: string, ageMs: number) =>
	adminDb.settlement.updateMany({
		where: { paymentGroupId: paymentId },
		data: { initiatedAt: new Date(NOW.getTime() - ageMs) },
	});

const state = async (paymentId: string) => ({
	header: await adminDb.payment.findUniqueOrThrow({
		where: { id: paymentId },
	}),
	rows: await adminDb.settlement.findMany({
		where: { paymentGroupId: paymentId },
		orderBy: [{ currency: "asc" }, { id: "asc" }],
	}),
});

const settledEntries = async (paymentId: string) =>
	(
		await adminDb.auditLogEntry.findMany({
			where: { action: "SETTLED", targetType: "SETTLEMENT" },
		})
	).filter(
		(e) =>
			(e.changes as { paymentGroupId?: string } | null)?.paymentGroupId ===
			paymentId,
	);

beforeAll(seedRates);

describe("auto-finalize of a payment pending for more than 7 days", () => {
	it("finalizes it as the payee: rows, header, split locks and audit", async () => {
		const p = await pair();
		const id = await pay(p, "37100");
		const before = await state(id);
		expect(before.header.status).toBe("PROPOSED");
		expect(before.rows.map((r) => [r.currency, r.amount.toString()])).toEqual([
			["ARS", "10000"],
			["BRL", "100"],
		]);

		const result = await sweepStalePayments(NOW);
		expect(result).toEqual({ ...NONE, finalized: 1 });

		const after = await state(id);
		expect(after.header.status).toBe("FINALIZED");
		// The payer's date and method stay, as they do when the payee confirms.
		expect(after.header.paidOn).toEqual(before.header.paidOn);
		expect(after.header.amount.toString()).toBe("37100");
		expect(
			after.rows.map((r) => [
				r.currency,
				r.amount.toString(),
				r.convertedAmount?.toString() ?? null,
				r.status,
				r.confirmedByPayer,
				r.confirmedByPayee,
				r.autoConfirmedReason,
				r.settledAt !== null,
			]),
		).toEqual([
			["ARS", "10000", null, "FINALIZED", true, true, null, true],
			["BRL", "100", "27100", "FINALIZED", true, true, null, true],
		]);
		// Both shares are locked: the payment brought each scope to zero.
		const locked = await adminDb.sharedTransaction.findMany({
			where: { id: { in: p.shares } },
			select: { isLocked: true },
		});
		expect(locked).toEqual([{ isLocked: true }, { isLocked: true }]);
		// Balances are zero for both sides, in both currencies.
		expect(
			(await computeBalance(adminDb, ref(p.payee), ref(p.payer))).byCurrency,
		).toEqual({});
		expect(
			(await computeBalance(adminDb, ref(p.payer), ref(p.payee))).byCurrency,
		).toEqual({});

		// One entry, written by the payee, readable by both people.
		const entries = await settledEntries(id);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			actorType: "user",
			actorId: p.payee.user.id,
			context: { action: "settlement_auto_finalized" },
			changes: { automatic: true, paymentGroupId: id },
		});
		const previous = (
			entries[0]?.changes as { previous: { amount: string; rows: unknown[] } }
		).previous;
		expect(previous.amount).toBe("37100");
		expect(previous.rows).toHaveLength(2);
		for (const who of [p.payer, p.payee]) {
			const seen = await who.db.auditLogEntry.findMany({
				where: { id: entries[0]?.id },
			});
			expect(seen).toHaveLength(1);
		}
	});

	it("appends payment.confirmed once, to the payee's feed and, by fan-out, the payer's", async () => {
		const p = await pair();
		const id = await pay(p, "37100");
		await sweepStalePayments(NOW);
		await sweepStalePayments(NOW);
		const confirmed = async (who: TestUser) =>
			(
				await readEventFeed(adminDb, who.user.id, { limit: 100 })
			).items.filter(
				(e) =>
					e.type === "payment.confirmed" &&
					(e.entity?.id === id || e.data.ids.paymentId === id),
			);
		// An event shows up once every older open transaction on the server has
		// finished (feed.ts), so give a busy test server time.
		await vi.waitFor(async () => {
			await fanOutEvents();
			expect(await confirmed(p.payer)).toHaveLength(1);
			expect(await confirmed(p.payee)).toHaveLength(1);
		}, 45_000);
		// The payee's own event carries the figures the payment moved (ARS 37,100
		// stops being owed to them), as a manual confirm's does; the payer's copy
		// carries none of the payee's amounts.
		const [mine] = await confirmed(p.payee);
		expect(mine?.data.amounts).toContainEqual({
			name: "owed.owedToYou",
			minor: -3_710_000,
			currency: "ARS",
		});
		const [theirs] = await confirmed(p.payer);
		expect(theirs?.data.amounts).toEqual([]);
	}, 60_000);

	it("does nothing the second time", async () => {
		const p = await pair();
		const id = await pay(p, "37100");
		expect((await sweepStalePayments(NOW)).finalized).toBe(1);
		const settledAt = (await state(id)).rows[0]?.settledAt;
		expect(await sweepStalePayments(NOW)).toEqual(NONE);
		expect(await settledEntries(id)).toHaveLength(1);
		expect((await state(id)).rows[0]?.settledAt).toEqual(settledAt);
	});

	it("leaves a payment younger than 7 days and one of exactly 7 days", async () => {
		const p = await pair();
		const fresh = await pay(p, "10000", 6 * DAY);
		const edge = await pay(p, "10000", 7 * DAY);
		expect(await sweepStalePayments(NOW)).toEqual(NONE);
		expect((await state(fresh)).header.status).toBe("PROPOSED");
		expect((await state(edge)).header.status).toBe("PROPOSED");

		// One millisecond past 7 days it is stale.
		await age(edge, 7 * DAY + 1);
		expect(await sweepStalePayments(NOW)).toEqual({ ...NONE, finalized: 1 });
		expect((await state(edge)).header.status).toBe("FINALIZED");
		expect((await state(fresh)).header.status).toBe("PROPOSED");
	});

	it("leaves a group with a row that is no longer pending", async () => {
		const p = await pair();
		const id = await pay(p, "37100");
		const [lead] = (await state(id)).rows;
		await adminDb.settlement.update({
			where: { id: lead?.id },
			data: { status: "REJECTED" },
		});
		expect(await sweepStalePayments(NOW)).toEqual(NONE);
		const { header, rows } = await state(id);
		expect(header.status).toBe("PROPOSED");
		expect(rows.map((r) => r.status)).toEqual(["REJECTED", "PROPOSED"]);
		expect(await settledEntries(id)).toHaveLength(0);
	});

	it("finalizes a payment once when two sweeps run at the same time", async () => {
		const p = await pair();
		const id = await pay(p, "37100");
		const [a, b] = await Promise.all([
			sweepStalePayments(NOW),
			sweepStalePayments(NOW),
		]);
		expect(a.finalized + b.finalized).toBe(1);
		expect(a.failed + b.failed).toBe(0);
		expect((await state(id)).header.status).toBe("FINALIZED");
		expect(await settledEntries(id)).toHaveLength(1);
	});

	it("lets only one replica sweep at a time and logs counts only", async () => {
		const p = await pair();
		await pay(p, "37100");
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			const results = await Promise.all([
				finalizeStaleProposedPayments(NOW),
				finalizeStaleProposedPayments(NOW),
			]);
			const total = results.reduce((t, r) => t + (r?.finalized ?? 0), 0);
			expect(total).toBe(1);
			const lines = log.mock.calls
				.map((c) => String(c[0]))
				.filter((l) => l.startsWith("Auto-finalize"));
			expect(lines).toEqual([
				"Auto-finalize: 1 finalized, 0 left pending (over-claimed), 0 changed meanwhile, 0 reopened, 0 failed",
			]);
		} finally {
			log.mockRestore();
		}
	});

	it("settles a payment once when a confirm runs at the same time", async () => {
		const p = await pair();
		const id = await pay(p, "37100");
		const [confirmed, swept] = await Promise.allSettled([
			forUser(p.payee.user.id).apply(confirmPayment, {
				paymentId: id,
				person: ref(p.payer),
			}),
			sweepStalePayments(NOW),
		]);
		// Whichever takes the pair lock first wins; the other changes nothing.
		expect(swept.status).toBe("fulfilled");
		const sweptCount = swept.status === "fulfilled" ? swept.value.finalized : 0;
		expect((confirmed.status === "fulfilled" ? 1 : 0) + sweptCount).toBe(1);
		if (confirmed.status === "rejected")
			expect(confirmed.reason).toMatchObject({ code: "BAD_REQUEST" });
		expect((await state(id)).header.status).toBe("FINALIZED");
		expect(await settledEntries(id)).toHaveLength(1);
	});

	it("leaves a payment the payee reopened for the payee to decide", async () => {
		const p = await pair();
		const id = await pay(p, "37100");
		await sweepStalePayments(NOW);
		// The payee says it never came: unconfirm puts the claim back.
		await forUser(p.payee.user.id).apply(unconfirmPayment, {
			paymentId: id,
			person: ref(p.payer),
		});
		const reopened = await state(id);
		expect(reopened.header.status).toBe("PROPOSED");
		expect(reopened.rows.every((r) => r.status === "PROPOSED")).toBe(true);
		// The rows keep their old date, so it is stale again, and still waits.
		expect(await sweepStalePayments(NOW)).toEqual(NONE);
		expect((await state(id)).header.status).toBe("PROPOSED");
		expect(
			(
				await adminDb.auditLogEntry.findMany({
					where: { targetId: reopened.rows[0]?.id },
				})
			).map((e) => (e.context as { action: string }).action),
		).toContain("settlement_unconfirmed");
	});

	it("re-checks under the lock: a payment reopened after the id list was built stays pending", async () => {
		const p = await pair();
		const id = await pay(p, "37100");
		let reopenedAfterList = false;
		// The id list is built while the payment has never been confirmed; the
		// payee then confirms and reopens it before the sweep reaches it.
		const source = {
			$queryRaw: async (...args: Parameters<typeof adminDb.$queryRaw>) => {
				const rows = await adminDb.$queryRaw(...args);
				if (!reopenedAfterList) {
					reopenedAfterList = true;
					await forUser(p.payee.user.id).apply(confirmPayment, {
						paymentId: id,
						person: ref(p.payer),
					});
					await forUser(p.payee.user.id).apply(unconfirmPayment, {
						paymentId: id,
						person: ref(p.payer),
					});
				}
				return rows;
			},
		} as unknown as Parameters<typeof sweepStalePayments>[1];
		expect(await sweepStalePayments(NOW, source)).toEqual({
			...NONE,
			reopened: 1,
		});
		expect((await state(id)).header.status).toBe("PROPOSED");
	});

	it("stops the pass when the transaction holding the sweep lock is gone", async () => {
		const p = await pair();
		const id = await pay(p, "37100");
		let calls = 0;
		const source = {
			$queryRaw: async (...args: Parameters<typeof adminDb.$queryRaw>) => {
				calls += 1;
				if (calls > 1) throw new Error("transaction is closed");
				return adminDb.$queryRaw(...args);
			},
		} as unknown as Parameters<typeof sweepStalePayments>[1];
		await expect(sweepStalePayments(NOW, source)).rejects.toThrow("closed");
		expect((await state(id)).header.status).toBe("PROPOSED");
		// Not stale any more, so later sweeps in this file leave it alone.
		await age(id, 0);
	});

	it("leaves an over-claim pending and counts it", async () => {
		const p = await pair(false);
		// The payer claims ARS 4,000; the payee then records ARS 8,000 as
		// received, so only ARS 2,000 of the 10,000 is still owed.
		const id = await pay(p, "4000");
		await applyPayment(p.payee.db, p.payee.user.id, {
			person: ref(p.payer),
			direction: "incoming",
			currency: "ARS",
			amount: "8000",
		});
		// Left pending, and an hourly pass over it writes no log line.
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await finalizeStaleProposedPayments(NOW)).toEqual({
				...NONE,
				overClaimed: 1,
			});
			expect(
				log.mock.calls.filter((c) => String(c[0]).startsWith("Auto-finalize")),
			).toEqual([]);
		} finally {
			log.mockRestore();
		}
		const { header, rows } = await state(id);
		expect(header.status).toBe("PROPOSED");
		expect(rows.map((r) => r.status)).toEqual(["PROPOSED"]);
		expect(await settledEntries(id)).toHaveLength(0);
	});

	it("is not voidable by the payer afterwards, like a payee's confirm", async () => {
		const p = await pair();
		const id = await pay(p, "37100");
		await sweepStalePayments(NOW);
		await expect(
			forUser(p.payer.user.id).apply(removeRecordedPayment, {
				paymentId: id,
				person: ref(p.payee),
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect((await state(id)).header.status).toBe("FINALIZED");
	});
});
