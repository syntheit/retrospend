/**
 * Correcting a settled split that has a rejected share, on real Postgres. A
 * correction plans from what the split is now, and a rejected share is not
 * owed (COUNTED_SHARE), so it must not be in that start: reversing it would
 * write a negative share for the person who rejected it, which counts.
 *
 * Fixture (ARS, minor = pesos x 100): a project; Ana paid ARS 90.00; Ana,
 * Bruno and Caro 30.00 each; Bruno REJECTED. Caro paid Ana 30.00 (final), so
 * the expense is settled and locked. Summary before, in minor units:
 *
 *   Ana   paid 9,000  share 3,000 + 3,000 absorbed = 6,000  received 3,000  balance 0
 *   Caro  share 3,000  sent 3,000  balance 0;  Bruno no lines.
 *
 * A. Correct to 60.00, Ana and Caro 30.00 each. The plan starts from Ana 6,000
 *    (her own 3,000 and Bruno's absorbed 3,000) and Caro 3,000, so the one row
 *    is amount -30.00 and Ana's share -30.00; Bruno is never in it.
 *    After: Ana paid 6,000 share 3,000 received 3,000 balance 0; Caro unchanged;
 *    Ana-Bruno and Ana-Caro stay 0 (the old code wrote Bruno -30.00, so Ana
 *    owed Bruno 30.00).
 *
 * B. Correct the payer to Caro, 90.00 split 30.00 each over Ana, Bruno, Caro.
 *    Row 1 reverses Ana's bucket: amount -90.00, Ana -60.00, Caro -30.00.
 *    Row 2 is Caro's: amount +90.00, 30.00 each, Bruno's PENDING (he owes it
 *    again). Differences: Ana paid -9,000 share -3,000; Bruno share +3,000;
 *    Caro paid +9,000 share 0.
 *    After: Ana-Bruno 0; Bruno owes Caro 3,000; Ana owes Caro 3,000 and has
 *    already received Caro's 3,000, so Ana-Caro is -6,000. Summary: Ana paid 0
 *    share 3,000 received 3,000 balance -6,000; Caro paid 9,000 share 3,000
 *    sent 3,000 balance 9,000; Bruno share 3,000 balance -3,000; they add up.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CorrectInput } from "~/lib/schemas/corrections";
import { userTransaction } from "~/server/db-tx";
import { forUser } from "~/server/services/preview";
import { computeBalance } from "~/server/services/shared-expenses/balance";
import { adminDb } from "~/test/pg-harness";
import {
	addMember,
	callerFor,
	namedUser,
	seedExpense,
	type TestUser,
} from "../project/__tests__/trip-fixture";
import { correctSplitMutation } from "./correct.mutation";

const who = (u: TestUser) => ({ type: "user" as const, id: u.user.id });

async function scene() {
	const [ana, bruno, caro] = [
		await namedUser("Ana"),
		await namedUser("Bruno"),
		await namedUser("Caro"),
	];
	const project = await adminDb.project.create({
		data: { name: "Asado", primaryCurrency: "ARS", createdById: ana.user.id },
	});
	await addMember(project.id, "user", ana.user.id, "ORGANIZER");
	await addMember(project.id, "user", bruno.user.id, "CONTRIBUTOR");
	await addMember(project.id, "user", caro.user.id, "CONTRIBUTOR");
	const expense = await seedExpense(project.id, {
		description: "Asado",
		amount: "90",
		currency: "ARS",
		date: "2026-10-08",
		paidBy: who(ana),
		isLocked: true,
		splits: [
			{ ...who(ana), share: "30" },
			{ ...who(bruno), share: "30", status: "REJECTED" },
			{ ...who(caro), share: "30" },
		],
	});
	await adminDb.settlement.create({
		data: {
			fromParticipantType: "user",
			fromParticipantId: caro.user.id,
			toParticipantType: "user",
			toParticipantId: ana.user.id,
			amount: "30",
			currency: "ARS",
			status: "FINALIZED",
			projectId: project.id,
		},
	});
	return { ana, bruno, caro, project, expense };
}

type Scene = Awaited<ReturnType<typeof scene>>;

const pair = (s: Scene, a: TestUser, b: TestUser) =>
	userTransaction(adminDb, s.ana.user.id, (tx) =>
		computeBalance(
			tx,
			{ participantType: "user", participantId: a.user.id },
			{ participantType: "user", participantId: b.user.id },
			{ viewer: { participantType: "user", participantId: s.ana.user.id } },
		),
	).then((r) => r.minorByCurrency);

async function lines(s: Scene) {
	const summary = await callerFor(s.ana.user).summary({
		projectId: s.project.id,
	});
	return {
		balancesAddUp: summary.balancesAddUp,
		rows: Object.fromEntries(
			summary.members.map((m) => [
				m.name,
				m.lines.map((l) => [
					l.paid.minor,
					l.share.minor,
					l.received.minor,
					l.sent.minor,
					l.balance.minor,
				]),
			]),
		),
	};
}

const correction = (s: Scene, over: Partial<CorrectInput>): CorrectInput => ({
	id: randomUUID(),
	transactionId: s.expense.id,
	description: "Correction to Asado",
	amount: "60",
	paidBy: who(s.ana),
	categoryId: null,
	splitMode: "EQUAL",
	splitWith: [{ participant: who(s.ana) }, { participant: who(s.caro) }],
	...over,
});

const rowsOf = (input: CorrectInput) =>
	adminDb.sharedTransaction.findMany({
		where: { correctsId: input.transactionId },
		include: { splitParticipants: true },
		orderBy: { id: "asc" },
	});

describe("correcting a split with a rejected share", () => {
	it("A: a smaller bill writes one row for Ana and never touches Bruno", async () => {
		const s = await scene();
		expect(await lines(s)).toEqual({
			balancesAddUp: true,
			rows: {
				Ana: [[9000, 6000, 3000, 0, 0]],
				Bruno: [],
				Caro: [[0, 3000, 0, 3000, 0]],
			},
		});
		const input = correction(s, {});

		const preview = await forUser(s.ana.user.id).preview(
			correctSplitMutation,
			input,
		);
		expect(await rowsOf(input)).toHaveLength(0);
		const applied = await forUser(s.ana.user.id).apply(
			correctSplitMutation,
			input,
		);
		// The preview is the write: the same value and the same figure changes.
		expect(applied.value).toEqual(preview.value);
		expect(applied.changes).toEqual(preview.changes);
		expect(applied.value.differences).toEqual([
			{
				participant: { type: "user", id: s.ana.user.id },
				paidMinor: -3000,
				shareMinor: -3000,
			},
		]);

		const rows = await rowsOf(input);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.amount.toString()).toBe("-30");
		expect(
			rows[0]?.splitParticipants.map((p) => [
				p.participantId,
				p.shareAmount.toString(),
			]),
		).toEqual([[s.ana.user.id, "-30"]]);

		expect(await pair(s, s.ana, s.bruno)).toEqual({});
		expect(await pair(s, s.ana, s.caro)).toEqual({});
		expect(await lines(s)).toEqual({
			balancesAddUp: true,
			rows: {
				Ana: [[6000, 3000, 3000, 0, 0]],
				Bruno: [],
				Caro: [[0, 3000, 0, 3000, 0]],
			},
		});
	});

	it("B: moving the payer to Caro asks Bruno again and reverses nothing under Ana for him", async () => {
		const s = await scene();
		const input = correction(s, {
			amount: "90",
			paidBy: who(s.caro),
			splitWith: [
				{ participant: who(s.ana) },
				{ participant: who(s.bruno) },
				{ participant: who(s.caro) },
			],
		});

		const preview = await forUser(s.ana.user.id).preview(
			correctSplitMutation,
			input,
		);
		const applied = await forUser(s.ana.user.id).apply(
			correctSplitMutation,
			input,
		);
		expect(applied.value).toEqual(preview.value);
		expect(applied.changes).toEqual(preview.changes);
		const diff = Object.fromEntries(
			applied.value.differences.map((d) => [
				d.participant.id,
				[d.paidMinor, d.shareMinor],
			]),
		);
		expect(diff).toEqual({
			[s.ana.user.id]: [-9000, -3000],
			[s.bruno.user.id]: [0, 3000],
			[s.caro.user.id]: [9000, 0],
		});

		const rows = await rowsOf(input);
		const byPayer = (id: string) => rows.find((r) => r.paidById === id);
		const shares = (id: string) =>
			Object.fromEntries(
				(byPayer(id)?.splitParticipants ?? []).map((p) => [
					p.participantId,
					[p.shareAmount.toString(), p.verificationStatus],
				]),
			);
		expect(byPayer(s.ana.user.id)?.amount.toString()).toBe("-90");
		expect(shares(s.ana.user.id)).toEqual({
			[s.ana.user.id]: ["-60", "ACCEPTED"],
			[s.caro.user.id]: ["-30", "AUTO_ACCEPTED"],
		});
		expect(byPayer(s.caro.user.id)?.amount.toString()).toBe("90");
		expect(shares(s.caro.user.id)).toEqual({
			[s.ana.user.id]: ["30", "ACCEPTED"],
			[s.bruno.user.id]: ["30", "PENDING"],
			[s.caro.user.id]: ["30", "PENDING"],
		});

		expect(await pair(s, s.ana, s.bruno)).toEqual({});
		expect(await pair(s, s.caro, s.bruno)).toEqual({ ARS: 3000 });
		expect(await pair(s, s.ana, s.caro)).toEqual({ ARS: -6000 });
		expect(await lines(s)).toEqual({
			balancesAddUp: true,
			rows: {
				Ana: [[0, 3000, 3000, 0, -6000]],
				Bruno: [[0, 3000, 0, 0, -3000]],
				Caro: [[9000, 3000, 0, 3000, 9000]],
			},
		});
	});
});
