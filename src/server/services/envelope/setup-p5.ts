/**
 * What setup writes for the P5 styles (SPEC §4.2, §4.3 step 4): group
 * targets (50/30/20), a leftover sweep (Save first, asked) and the style's
 * income rules (Save first). Rules created at setup see every money in
 * logged after it, like any rule.
 */
import { randomUUID } from "node:crypto";
import type { GroupTargetInput, SetupInput } from "~/lib/schemas/envelope";
import { Prisma } from "~prisma";
import { EnvelopeError } from "./errors";
import { ruleColumns } from "./rule-store";
import { fromMinor } from "./units";

type Tx = Prisma.TransactionClient;

function invalid(message: string): never {
	throw new EnvelopeError("INVALID", message);
}

/** Columns for a group's target: an amount in H, or a percent (30.0). */
export function groupTargetColumns(t: GroupTargetInput | undefined, H: string) {
	if (!t || t.kind === "NONE") return { targetKind: "NONE" as const, targetValue: null };
	return {
		targetKind: t.kind,
		targetValue:
			t.kind === "AMOUNT"
				? new Prisma.Decimal(fromMinor(t.amountMinor, H).toString())
				: new Prisma.Decimal(t.basisPoints).dividedBy(100),
	};
}

/** Sweeps and rules name envelopes of this setup; rule matches name the user's own rows. */
export async function validateSetupExtras(tx: Tx, input: SetupInput) {
	const keys = new Set(input.envelopes.map((e) => e.key));
	for (const e of input.envelopes) {
		if (!e.sweepToKey) continue;
		if (!keys.has(e.sweepToKey) || e.sweepToKey === e.key)
			invalid(`envelope ${e.key} sweeps to an unknown envelope`);
		if (e.kind !== "MONTHLY") invalid("only Monthly envelopes sweep leftovers");
	}
	for (const r of input.rules ?? []) {
		if (!keys.has(r.envelopeKey)) invalid("a rule names an unknown envelope");
		if (r.match.kind === "CATEGORY") {
			const ok = await tx.category.count({
				where: { id: r.match.categoryId, kind: "INCOME" },
			});
			if (!ok) invalid("a rule names an unknown income category");
		}
		if (r.match.kind === "TEMPLATE") {
			const ok = await tx.recurringTemplate.count({
				where: { id: r.match.templateId, direction: "IN" },
			});
			if (!ok) invalid("a rule names an unknown recurring money in");
		}
	}
}

export async function writeSetupExtras(
	tx: Tx,
	p: {
		bookId: string;
		input: SetupInput;
		envelopeIds: ReadonlyMap<string, string>;
		currency: string;
		now: Date;
	},
) {
	for (const e of p.input.envelopes) {
		if (!e.sweepToKey) continue;
		await tx.envelope.update({
			where: { id: p.envelopeIds.get(e.key) as string },
			data: {
				leftoverRule: "SWEEP",
				leftoverSweepToId: p.envelopeIds.get(e.sweepToKey) as string,
			},
		});
	}
	const rules = p.input.rules ?? [];
	for (const [i, r] of rules.entries())
		await tx.incomeRule.create({
			data: {
				id: randomUUID(),
				bookId: p.bookId,
				name: r.name,
				sortOrder: i,
				envelopeId: p.envelopeIds.get(r.envelopeKey) as string,
				createdAt: p.now,
				...ruleColumns(r.match, r.action, p.currency),
			} as Prisma.IncomeRuleUncheckedCreateInput,
		});
}
