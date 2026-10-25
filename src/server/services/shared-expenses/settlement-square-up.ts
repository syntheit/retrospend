/**
 * "Square up projects": when the overall balance with someone in a currency
 * is even but their projects point in opposite directions, offsets alone
 * (no cash) bring every project to zero. Split from settlement.service.ts.
 */
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { currencyDecimals } from "~/lib/money";
import {
	createNotification,
	resolveParticipantName,
} from "~/server/services/notifications";
import {
	assertRelationship,
	lockPair,
} from "~/server/services/payments/access";
import { allocatePayment } from "~/server/services/payments/allocate";
import { confirmationFor } from "~/server/services/payments/confirmation";
import { ledgerLines, payerLines } from "~/server/services/payments/ledger";
import { paidOnDate } from "~/server/services/payments/record.mutation";
import { writePayment } from "~/server/services/payments/write";
import type { FigureDb } from "~/server/figures/registry";
import type { PrismaClient } from "~prisma";
import { computeBalanceByProject, computePairLedger } from "./balance";
import { type ParticipantRef, sameParticipant } from "./types";

/** Owed amounts at or below this are treated as nothing owed. */
const OWED_TOLERANCE = 0.005;

const formatAmount = (amount: number, currency: string) =>
	amount.toFixed(currencyDecimals(currency));

/**
 * Currencies where a pair's overall balance is even (within the owed
 * tolerance) while project scopes still point in opposite directions.
 * `byProject` is signed from the current user's side (positive = they owe).
 * `amount` is what squaring up cancels: the larger side of the offsets.
 */
function squareUpCandidates(
	byProject: Map<string | null, Record<string, number>>,
) {
	const currencies = new Set<string>();
	for (const scope of byProject.values())
		for (const c of Object.keys(scope)) currencies.add(c);

	const options: Array<{
		currency: string;
		amount: number;
		scopes: Array<{ projectId: string | null; balance: number }>;
	}> = [];
	for (const currency of [...currencies].sort()) {
		const scopes: Array<{ projectId: string | null; balance: number }> = [];
		let total = 0;
		let owedToMe = 0;
		let owedByMe = 0;
		for (const [projectId, byCurrency] of byProject) {
			const balance = byCurrency[currency] ?? 0;
			if (Math.abs(balance) <= OWED_TOLERANCE) continue;
			scopes.push({ projectId, balance });
			total += balance;
			if (balance > 0) owedToMe += balance;
			else owedByMe -= balance;
		}
		if (owedToMe === 0 || owedByMe === 0) continue;
		if (Math.abs(total) > OWED_TOLERANCE) continue;
		options.push({ currency, amount: Math.max(owedToMe, owedByMe), scopes });
	}
	return options;
}

/**
 * Currencies where the overall balance with `ref` is even but project
 * scopes are not, in opposite directions (e.g. you owe 30 in Trip and are
 * owed 30 in Rent). Read-only; squareUpProjects records the offsets.
 */
export async function getSquareUpOptions(
	db: PrismaClient,
	me: ParticipantRef,
	ref: ParticipantRef,
) {
	await assertRelationship(db, me, ref);
	const byProject = await computeBalanceByProject(db, me, ref);
	const options = squareUpCandidates(byProject);
	if (options.length === 0) return [];

	const projectIds = [
		...new Set(
			options.flatMap((o) =>
				o.scopes.map((s) => s.projectId).filter((p): p is string => p !== null),
			),
		),
	];
	const projects =
		projectIds.length > 0
			? await db.project.findMany({
					where: { id: { in: projectIds } },
					select: { id: true, name: true },
				})
			: [];
	const names = new Map(projects.map((p) => [p.id, p.name]));

	return options.map((o) => ({
		...o,
		scopes: o.scopes.map((s) => ({
			...s,
			projectName: s.projectId ? (names.get(s.projectId) ?? null) : null,
		})),
	}));
}

export interface SquareUpInput {
	toParticipant: ParticipantRef;
	currency: string;
}

type Tx = FigureDb;

/**
 * The write of "Square up projects", on the caller's transaction: records
 * only offset rows (no cash) so every project scope ends at zero:
 * allocatePayment with nothing to pay and everything to offset. Handled like
 * a payment the current user sends: a registered user confirms or rejects
 * it, a ghost or guest is auto-confirmed. Same pair lock as a payment. The
 * notice goes out after the commit (notifySquaredUp).
 */
export async function squareUpIn(
	tx: Tx,
	me: ParticipantRef,
	input: SquareUpInput,
) {
	if (sameParticipant(me, input.toParticipant)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Cannot create a settlement with yourself",
		});
	}
	await assertRelationship(tx, me, input.toParticipant);
	const other = input.toParticipant;

	await lockPair(tx, me, other);
	const byProject = await computeBalanceByProject(tx, me, other);
	const option = squareUpCandidates(byProject).find(
		(o) => o.currency === input.currency,
	);
	if (!option) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `There are no ${input.currency} project balances to square up with this person.`,
		});
	}
	const events = await computePairLedger(tx, me, other, { viewer: me });
	const allocation = allocatePayment({
		lines: payerLines(ledgerLines(events), true),
		currency: input.currency,
		amount: 0,
		quotes: new Map(),
		applyTo: [{ currency: input.currency }],
	});
	const id = randomUUID();
	const now = new Date();
	const created = await writePayment(tx, {
		id,
		parties: { payer: me, payee: other, recorder: me },
		allocation,
		confirmation: confirmationFor(false, other.participantType),
		paidOn: paidOnDate(null, now),
		now,
		paymentMethod: null,
		note: null,
		auditTags: { squareUp: true },
	});
	return {
		settlements: created,
		paymentGroupId: id,
		offset: option.amount,
		requiresPayeeConfirmation: created[0]?.status === "PROPOSED",
	};
}

export type SquaredUp = Awaited<ReturnType<typeof squareUpIn>>;

/** Tells the other person, from the name and the amount only. */
export async function notifySquaredUp(
	me: ParticipantRef,
	input: SquareUpInput,
	done: SquaredUp,
) {
	if (input.toParticipant.participantType !== "user") return;
	const myName = await resolveParticipantName("user", me.participantId);
	const formatted = `${input.currency} ${formatAmount(done.offset, input.currency)}`;
	createNotification({
		userId: input.toParticipant.participantId,
		type: "SETTLEMENT_RECEIVED",
		title: "Project balances squared up",
		body: `${myName} squared up your project balances (an offset of ${formatted}, no money moved)`,
		data: {
			settlementId: done.settlements[0]?.id,
			paymentGroupId: done.paymentGroupId,
			fromParticipantType: "user",
			fromParticipantId: me.participantId,
		},
	}).catch((err) =>
		console.error("[Notification Error] SETTLEMENT_RECEIVED:", err),
	);
}

/** "Square up projects" as the web runs it: the write, then the notice. */
export async function squareUpProjects(
	db: PrismaClient,
	me: ParticipantRef,
	input: SquareUpInput,
) {
	const done = await db.$transaction((tx) => squareUpIn(tx, me, input));
	await notifySquaredUp(me, input, done);
	return {
		settlements: done.settlements,
		paymentGroupId: done.paymentGroupId,
		requiresPayeeConfirmation: done.requiresPayeeConfirmation,
	};
}
