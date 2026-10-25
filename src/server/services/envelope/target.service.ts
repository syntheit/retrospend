/**
 * Set a target (SPEC §5.4): what an envelope is for and the amount it aims
 * for. Replaces the whole target (nothing of the old one survives) and counts
 * from the current month ("recalculates from today"). A target typed in
 * another currency keeps it (D25): it is converted each month, never now, so
 * the preview shows "about X today" from today's rate and flags a missing one
 * instead of valuing it at 1 (R14).
 *
 * Moves no money. The previous target is stored in the change log, so the
 * undo puts back exactly what was there, whichever columns it used.
 */
import type { TargetInput } from "~/lib/schemas/envelope";
import type {
	SetTargetInput,
	SetTargetResult,
} from "~/lib/schemas/envelope-crud";
import { Prisma } from "~prisma";
import { leftoverDefault } from "./book.service";
import { assertNewChange, recordChange } from "./envelope-change";
import { EnvelopeError } from "./errors";
import { restoreData, snapshotOf } from "./limit-target";
import { forgetMonthViews } from "./month-read";
import { checkEnvelope, lockedSnapshot, snapshot } from "./movement-state";
import type { EnvelopeTarget } from "./needs";
import { checkTarget, replaceTarget } from "./target-write";
import type { Minor } from "./types";

type Tx = Prisma.TransactionClient;

/** The amount a target aims for, in the book currency; null for a goal set by its monthly amount alone. */
function amountOf(t: EnvelopeTarget | null): Minor | null {
	return t ? t.amount : null;
}

/** The amount as typed, in its own currency. Targets that follow a template or a debt have none of their own. */
function typedOf(input: SetTargetInput, H: string) {
	const t: TargetInput | null = input.target;
	if (!t || t.kind === "BILL_TEMPLATE" || t.kind === "BILL_LIABILITY")
		return null;
	return t.amountMinor === undefined
		? null
		: { minor: t.amountMinor, currency: t.currency ?? H };
}

export async function setTarget(
	tx: Tx,
	userId: string,
	input: SetTargetInput,
	now: Date,
): Promise<SetTargetResult> {
	const s = await lockedSnapshot(tx, userId, now);
	checkEnvelope(input.envelopeId, s);
	const env = s.loaded.row.envelopes.find((e) => e.id === input.envelopeId);
	if (!env) throw new EnvelopeError("NOT_FOUND", "no such envelope");
	const H = s.loaded.book.currency;
	if (
		env.id === s.loaded.row.defaultEnvelopeId &&
		input.kind !== "MONTHLY" &&
		input.kind !== "NONE"
	)
		throw new EnvelopeError(
			"INVALID",
			"Everything else is a Monthly or No target envelope",
		);
	if (env.wealthAccountId && input.kind !== "SAVINGS")
		throw new EnvelopeError(
			"INVALID",
			"an envelope linked to a Wealth account stays a savings goal",
		);
	await checkTarget(tx, input.kind, input.target);
	await assertNewChange(tx, input.id);
	const previous = snapshotOf(env);
	// Stored rules only count on Monthly envelopes, so entering Monthly takes the style's default.
	const entersMonthly = input.kind === "MONTHLY" && env.kind !== "MONTHLY";
	await tx.envelope.update({
		where: { id: env.id },
		data: {
			kind: input.kind,
			...replaceTarget(input.target ?? undefined, H, s.current),
			...(entersMonthly
				? {
						leftoverRule: leftoverDefault(s.loaded.row.style),
						leftoverSweepToId: null,
					}
				: {}),
			// The one-step limit undo (revertLimit) belongs to the target it saw.
			limitUndo: Prisma.DbNull,
		},
	});
	await recordChange(tx, {
		id: input.id,
		bookId: s.loaded.row.id,
		userId,
		kind: "SET_TARGET",
		envelopeId: env.id,
		before: {
			target: previous,
			leftoverRule: env.leftoverRule,
			leftoverSweepToId: env.leftoverSweepToId,
		},
	});
	forgetMonthViews(tx);
	const after = await snapshot(tx, userId, now);
	const view = after.loaded.book.envelopes.find((e) => e.id === env.id);
	const inBook = amountOf(view?.target ?? null);
	const fresh = await tx.envelope.findUniqueOrThrow({ where: { id: env.id } });
	return {
		changeId: input.id,
		envelopeId: env.id,
		target: snapshotOf(fresh),
		previous,
		typed: typedOf(input, H),
		inBook: inBook === null ? null : { minor: inBook, currency: H },
		incomplete: view?.targetIncomplete ?? false,
	};
}

/** The undo of setTarget: the stored columns back, exactly. */
export async function restoreTarget(
	tx: Tx,
	envelopeId: string,
	before: {
		target: Parameters<typeof restoreData>[0];
		leftoverRule: "CARRY" | "RETURN" | "SWEEP";
		leftoverSweepToId: string | null;
	},
) {
	await tx.envelope.update({
		where: { id: envelopeId },
		data: {
			...restoreData(before.target),
			leftoverRule: before.leftoverRule,
			leftoverSweepToId: before.leftoverSweepToId,
			limitUndo: Prisma.DbNull,
		},
	});
	forgetMonthViews(tx);
}
