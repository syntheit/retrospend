/**
 * An envelope's target as stored columns: what setup, "Set a target" and
 * "Add envelope" write (SPEC §5.4). A target typed in another currency keeps
 * that currency (D25) and is converted each month, never at save time. A new
 * target counts from the month it is set ("recalculates from today").
 */
import type { TargetInput } from "~/lib/schemas/envelope";
import { Prisma } from "~prisma";
import { EnvelopeError } from "./errors";
import { REPEAT_MONTHS } from "./target-input";
import { savingsShape } from "./targets";
import { TargetConfigError } from "./types";
import { fromMinor } from "./units";

type Tx = Prisma.TransactionClient;

export const LIABILITY_TYPES = [
	"LIABILITY_LOAN",
	"LIABILITY_CREDIT_CARD",
	"LIABILITY_MORTGAGE",
] as const;

/** The envelope kind each target input needs. */
export const KIND_FOR: Record<TargetInput["kind"], string> = {
	MONTHLY: "MONTHLY",
	BILL: "BILL",
	BILL_TEMPLATE: "BILL",
	BILL_LIABILITY: "BILL",
	SAVINGS: "SAVINGS",
};

/** The columns of a target, for a row that has none yet (setup, create). */
export function targetColumns(
	t: TargetInput | undefined,
	H: string,
	startMonth: number,
) {
	if (!t) return {};
	if (t.kind === "BILL_TEMPLATE")
		return { targetTemplateId: t.templateId, targetStartMonth: startMonth };
	if (t.kind === "BILL_LIABILITY")
		return { targetLiabilityId: t.liabilityId, targetStartMonth: startMonth };
	const currency = t.currency ?? H;
	const foreign = currency === H ? null : currency;
	const amount = (minor: number | undefined) =>
		minor === undefined
			? null
			: new Prisma.Decimal(fromMinor(minor, currency).toString());
	const day = (d: string | undefined) =>
		d ? new Date(`${d}T00:00:00Z`) : null;
	const base = { targetCurrency: foreign, targetStartMonth: startMonth };
	if (t.kind === "MONTHLY")
		return {
			...base,
			targetAmount: amount(t.amountMinor),
			targetMode: t.mode,
			targetCadence: t.cadence,
		};
	if (t.kind === "BILL")
		return {
			...base,
			targetAmount: amount(t.amountMinor),
			targetDueDate: day(t.dueDate),
			targetRepeat: t.repeat,
		};
	return {
		...base,
		targetAmount: amount(t.amountMinor),
		targetDueDate: day(t.dueDate),
		targetMonthlyAmount: amount(t.monthlyMinor),
	};
}

/** Every target column cleared: the base a replacement is written over. */
export const NO_TARGET = {
	targetAmount: null,
	targetMode: "REFILL",
	targetCadence: "MONTH",
	targetMonthlyAmount: null,
	targetCurrency: null,
	targetDueDate: null,
	targetRepeat: null,
	targetTemplateId: null,
	targetLiabilityId: null,
	targetStartMonth: null,
} as const;

/** The update that replaces a target whole: nothing of the old one survives. */
export function replaceTarget(
	t: TargetInput | undefined,
	H: string,
	startMonth: number,
) {
	return { ...NO_TARGET, ...targetColumns(t, H, startMonth) };
}

function invalid(message: string): never {
	throw new EnvelopeError("INVALID", message);
}

/** The envelope kind a target needs, its shape, and the template or debt it follows. RLS shows only the user's own rows. */
export async function checkTarget(
	tx: Tx,
	kind: string,
	target: TargetInput | null | undefined,
) {
	if (!target) {
		if (kind !== "NONE" && kind !== "MONTHLY")
			invalid("a bill or a goal needs a target");
		return;
	}
	if (KIND_FOR[target.kind] !== kind)
		invalid(
			`a ${target.kind} target needs a ${KIND_FOR[target.kind]} envelope`,
		);
	if (target.kind === "SAVINGS") {
		try {
			savingsShape({
				amount: target.amountMinor,
				dueMonth: target.dueDate ? 1 : null,
				monthly: target.monthlyMinor,
			});
		} catch (error) {
			if (error instanceof TargetConfigError) invalid(error.message);
			throw error;
		}
	}
	if (target.kind === "BILL_LIABILITY") {
		const n = await tx.assetAccount.count({
			where: {
				id: target.liabilityId,
				type: { in: [...LIABILITY_TYPES] },
			},
		});
		if (n !== 1) invalid("a bill follows one of your debts");
	}
	if (target.kind === "BILL_TEMPLATE") {
		const t = await tx.recurringTemplate.findFirst({
			where: { id: target.templateId, direction: "OUT" },
			select: { frequency: true },
		});
		if (!t || REPEAT_MONTHS[t.frequency] === undefined)
			invalid(
				"a bill follows a recurring expense that repeats monthly, quarterly or yearly",
			);
	}
}
