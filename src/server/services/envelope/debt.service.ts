/**
 * Debts in the budget (SPEC §5.11, D3, D72): liability terms, the payoff
 * plan and its projection.
 *
 * - Terms: APR, minimum and due day live on the liability (asset_account);
 *   editing them moves no money.
 * - The plan: one per book, a projection input only. Saving it gives the
 *   "Extra debt payment" envelope a Set aside target equal to the extra.
 * - The projection starts from today's balances. A debt in another currency
 *   is projected in its own currency; one with no rate today to the book
 *   currency is left out and listed (R14), never valued at 1.
 *
 * Pay down a debt is in debt-payment.service.ts.
 */

import { randomUUID } from "node:crypto";
import { payoffFrom } from "@retrospend/domain/envelope/debt-read";
import { z } from "zod";
import type {
	DebtTerms,
	DebtTermsResult,
	PayoffPlanDto,
	PayoffPlanResult,
	PayoffProjectInput,
	PayoffProjection,
	SavePayoffPlanInput,
	SetDebtTermsInput,
} from "~/lib/schemas/envelope-debt";
import { Prisma } from "~prisma";
import { EnvelopeError } from "./errors";
import { findPersonalBook } from "./inputs";
import { forgetMonthViews } from "./month-read";
import { loadRateRows } from "./rate-book";
import { LIABILITY_TYPES } from "./target-write";
import { dec, fromMinor, toMinor } from "./units";

type Tx = Prisma.TransactionClient;

function invalid(message: string): never {
	throw new EnvelopeError("INVALID", message);
}

type Liability = Awaited<ReturnType<typeof liabilitiesOf>>[number];

/** The user's open liabilities (RLS shows only theirs), oldest first. */
export function liabilitiesOf(tx: Tx, ids?: readonly string[]) {
	return tx.assetAccount.findMany({
		where: {
			type: { in: [...LIABILITY_TYPES] },
			closedAt: null,
			...(ids ? { id: { in: [...ids] } } : {}),
		},
		orderBy: [{ createdAt: "asc" }, { id: "asc" }],
	});
}

function termsOf(a: Liability): DebtTerms {
	return {
		assetAccountId: a.id,
		aprPercent: a.interestRate ? dec(a.interestRate).toString() : null,
		minimum: a.minimumPayment
			? { minor: toMinor(a.minimumPayment, a.currency), currency: a.currency }
			: null,
		dueDay: a.dueDate,
	};
}

export async function setDebtTerms(
	tx: Tx,
	input: SetDebtTermsInput,
): Promise<DebtTermsResult> {
	const [a] = await liabilitiesOf(tx, [input.assetAccountId]);
	if (!a) throw new EnvelopeError("NOT_FOUND", "no such debt");
	const updated = await tx.assetAccount.update({
		where: { id: a.id },
		data: {
			interestRate:
				input.aprPercent === null ? null : new Prisma.Decimal(input.aprPercent),
			minimumPayment:
				input.minimumMinor === null
					? null
					: new Prisma.Decimal(
							fromMinor(input.minimumMinor, a.currency).toString(),
						),
			dueDate: input.dueDay,
		},
	});
	forgetMonthViews(tx);
	return { terms: termsOf(updated), previous: termsOf(a) };
}

async function requireBook(tx: Tx, userId: string) {
	const book = await findPersonalBook(tx, userId);
	if (!book?.defaultEnvelopeId)
		throw new EnvelopeError("NO_BOOK", "start a budget first");
	return book;
}

function planDto(
	p: {
		strategy: PayoffPlanDto["strategy"];
		extraMonthly: Prisma.Decimal;
		customOrder: unknown;
		envelopeId: string | null;
	},
	H: string,
): PayoffPlanDto {
	return {
		strategy: p.strategy,
		extraMonthly: { minor: toMinor(p.extraMonthly, H), currency: H },
		customOrder: z.array(z.string()).parse(p.customOrder),
		envelopeId: p.envelopeId,
	};
}

/** The book's plan; with none yet, Avalanche with no extra (the default). */
export async function getPayoffPlan(
	tx: Tx,
	userId: string,
): Promise<PayoffPlanDto> {
	const book = await requireBook(tx, userId);
	const p = await tx.payoffPlan.findUnique({ where: { bookId: book.id } });
	return p
		? planDto(p, book.currency)
		: {
				strategy: "AVALANCHE",
				extraMonthly: { minor: 0, currency: book.currency },
				customOrder: [],
				envelopeId: null,
			};
}

export async function savePayoffPlan(
	tx: Tx,
	userId: string,
	input: SavePayoffPlanInput,
): Promise<PayoffPlanResult> {
	const book = await requireBook(tx, userId);
	const H = book.currency;
	const env = input.envelopeId
		? book.envelopes.find(
				(e) => e.id === input.envelopeId && e.archivedAt === null,
			)
		: null;
	if (input.envelopeId && (!env || env.kind !== "MONTHLY"))
		invalid("the extra goes to a Monthly envelope of your budget");
	const known = new Set(
		(await liabilitiesOf(tx, input.customOrder)).map((a) => a.id),
	);
	if (input.customOrder.some((id) => !known.has(id)))
		invalid("your order names one of your debts");
	const before = await tx.payoffPlan.findUnique({ where: { bookId: book.id } });
	const undo = {
		plan: before
			? {
					strategy: before.strategy,
					extraMonthly: before.extraMonthly.toString(),
					customOrder: z.array(z.string()).parse(before.customOrder),
					envelopeId: before.envelopeId,
				}
			: null,
		target: env
			? {
					envelopeId: env.id,
					targetAmount: env.targetAmount?.toString() ?? null,
					targetMode: env.targetMode,
					targetCadence: env.targetCadence,
					targetCurrency: env.targetCurrency,
				}
			: null,
	};
	const data = {
		strategy: input.strategy,
		extraMonthly: new Prisma.Decimal(
			fromMinor(input.extraMonthlyMinor, H).toString(),
		),
		customOrder: input.customOrder,
		envelopeId: input.envelopeId,
	};
	const saved = await tx.payoffPlan.upsert({
		where: { bookId: book.id },
		create: { id: randomUUID(), bookId: book.id, ...data, undo },
		update: { ...data, undo },
	});
	// "Extra debt payment" gets a Set aside target equal to the plan's extra (SPEC §5.11).
	if (env)
		await tx.envelope.update({
			where: { id: env.id },
			data: {
				targetAmount: data.extraMonthly,
				targetMode: "SET_ASIDE",
				targetCadence: "MONTH",
				targetCurrency: null,
			},
		});
	forgetMonthViews(tx);
	return {
		plan: planDto(saved, H),
		previous: before ? planDto(before, H) : null,
	};
}

const undoSchema = z.object({
	plan: z
		.object({
			strategy: z.enum(["SNOWBALL", "AVALANCHE", "CUSTOM"]),
			extraMonthly: z.string(),
			customOrder: z.array(z.string()),
			envelopeId: z.string().nullable(),
		})
		.nullable(),
	target: z
		.object({
			envelopeId: z.string(),
			targetAmount: z.string().nullable(),
			targetMode: z.enum(["REFILL", "SET_ASIDE"]),
			targetCadence: z.enum(["MONTH", "WEEK"]),
			targetCurrency: z.string().nullable(),
		})
		.nullable(),
});

/**
 * Undo of the last save: the plan it replaced (or none: the default plan)
 * and the extra envelope's target exactly as they were, read from the row,
 * never from the client.
 */
export async function revertPayoffPlan(
	tx: Tx,
	userId: string,
): Promise<PayoffPlanResult> {
	const book = await requireBook(tx, userId);
	const H = book.currency;
	const row = await tx.payoffPlan.findUnique({ where: { bookId: book.id } });
	const undo = row?.undo ? undoSchema.parse(row.undo) : null;
	if (!row || !undo) invalid("nothing to undo");
	// The save set the extra envelope's target; a later edit of it is not ours to overwrite.
	if (undo.target) {
		const env = await tx.envelope.findUnique({
			where: { id: undo.target.envelopeId },
		});
		const unchanged =
			env !== null &&
			env.targetAmount !== null &&
			env.targetAmount.equals(row.extraMonthly) &&
			env.targetMode === "SET_ASIDE" &&
			env.targetCadence === "MONTH" &&
			env.targetCurrency === null;
		if (!unchanged)
			throw new EnvelopeError(
				"ALREADY_UNDONE",
				"the extra envelope's target changed since the save, so undoing it would overwrite that",
			);
	}
	const p = undo.plan;
	const restored = await tx.payoffPlan.update({
		where: { id: row.id },
		data: {
			strategy: p?.strategy ?? "AVALANCHE",
			extraMonthly: new Prisma.Decimal(p?.extraMonthly ?? 0),
			customOrder: p?.customOrder ?? [],
			envelopeId: p?.envelopeId ?? null,
			undo: Prisma.DbNull,
		},
	});
	const t = undo.target;
	if (t)
		await tx.envelope.update({
			where: { id: t.envelopeId },
			data: {
				targetAmount:
					t.targetAmount === null ? null : new Prisma.Decimal(t.targetAmount),
				targetMode: t.targetMode,
				targetCadence: t.targetCadence,
				targetCurrency: t.targetCurrency,
			},
		});
	forgetMonthViews(tx);
	return { plan: planDto(restored, H), previous: planDto(row, H) };
}

/** The projection for the saved plan, or for the overrides the slider tries. Never writes. */
export function projectIn(
	tx: Tx,
	userId: string,
	input: PayoffProjectInput,
	now: Date,
): Promise<PayoffProjection> {
	return payoffFrom(
		{
			book: () => requireBook(tx, userId),
			savedPlan: () => getPayoffPlan(tx, userId),
			liabilities: () => liabilitiesOf(tx),
			rateRows: (p) => loadRateRows(tx, p),
		},
		input,
		now,
	);
}
