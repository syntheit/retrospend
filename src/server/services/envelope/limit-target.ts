/**
 * An envelope's stored target columns as one snapshot, so a "From now on"
 * limit can be undone exactly (kind, mode, cadence, currency and every
 * other target column come back as they were), and the PLAN_FUND delta that
 * moves this month's funding to a given amount (SPEC §5.6).
 */
import type { TargetSnapshot } from "~/lib/schemas/envelope-book";
import { Prisma } from "~prisma";
import type { NewMovement } from "./movement-state";
import type { Minor, MonthKey } from "./types";
import { toMinor } from "./units";

type Tx = Prisma.TransactionClient;

type TargetRow = {
	kind: TargetSnapshot["kind"];
	targetAmount: Prisma.Decimal | null;
	targetCurrency: string | null;
	targetMode: TargetSnapshot["targetMode"];
	targetCadence: TargetSnapshot["targetCadence"];
	targetMonthlyAmount: Prisma.Decimal | null;
	targetDueDate: Date | null;
	targetRepeat: string | null;
	targetTemplateId: string | null;
	targetLiabilityId: string | null;
	targetStartMonth: number | null;
};

export function snapshotOf(e: TargetRow): TargetSnapshot {
	return {
		kind: e.kind,
		targetAmount: e.targetAmount?.toString() ?? null,
		targetCurrency: e.targetCurrency,
		targetMode: e.targetMode,
		targetCadence: e.targetCadence,
		targetMonthlyAmount: e.targetMonthlyAmount?.toString() ?? null,
		targetDueDate: e.targetDueDate?.toISOString().slice(0, 10) ?? null,
		targetRepeat: e.targetRepeat,
		targetTemplateId: e.targetTemplateId,
		targetLiabilityId: e.targetLiabilityId,
		targetStartMonth: e.targetStartMonth,
	};
}

const dec = (v: string | null) => (v === null ? null : new Prisma.Decimal(v));

/** The update that writes a snapshot back. */
export function restoreData(s: TargetSnapshot) {
	return {
		kind: s.kind,
		targetAmount: dec(s.targetAmount),
		targetCurrency: s.targetCurrency,
		targetMode: s.targetMode,
		targetCadence: s.targetCadence,
		targetMonthlyAmount: dec(s.targetMonthlyAmount),
		targetDueDate: s.targetDueDate
			? new Date(`${s.targetDueDate}T00:00:00Z`)
			: null,
		targetRepeat: s.targetRepeat as Prisma.EnvelopeUpdateInput["targetRepeat"],
		targetTemplateId: s.targetTemplateId,
		targetLiabilityId: s.targetLiabilityId,
		targetStartMonth: s.targetStartMonth,
	};
}

/** What this month's plan funding gave the envelope, net of later deltas and undos. */
export async function fundedThisMonth(
	tx: Tx,
	p: { bookId: string; envelopeId: string; month: MonthKey; currency: string },
): Promise<Minor> {
	const rows = await tx.budgetMovement.findMany({
		where: {
			bookId: p.bookId,
			month: p.month,
			kind: "PLAN_FUND",
			OR: [{ toEnvelopeId: p.envelopeId }, { fromEnvelopeId: p.envelopeId }],
		},
		select: { id: true, amount: true, toEnvelopeId: true },
	});
	const undone = new Set(
		(
			await tx.budgetMovement.findMany({
				where: { revertsId: { in: rows.map((r) => r.id) } },
				select: { revertsId: true },
			})
		).map((r) => r.revertsId),
	);
	return rows
		.filter((r) => !undone.has(r.id))
		.reduce((t, r) => {
			const v = toMinor(r.amount.toString(), p.currency);
			return t + (r.toEnvelopeId === p.envelopeId ? v : -v);
		}, 0);
}

/** The PLAN_FUND row that takes this month's funding from `funded` to `to` (none when equal). */
export function fundDelta(p: {
	id: string;
	envelopeId: string;
	month: MonthKey;
	funded: Minor;
	to: Minor;
}): NewMovement[] {
	const delta = p.to - p.funded;
	if (delta === 0) return [];
	return [
		{
			id: p.id,
			month: p.month,
			from: delta > 0 ? null : p.envelopeId,
			to: delta > 0 ? p.envelopeId : null,
			minor: Math.abs(delta),
			kind: "PLAN_FUND",
			batchId: null,
		},
	];
}
