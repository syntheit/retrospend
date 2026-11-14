/**
 * Loads what splits mean to one person's budget (02 §3.3, §5.3 queries 5 to
 * 7, SPEC §5.8), through the caller's transaction so RLS applies. What the
 * rows mean (each share's category, the replay) is pure and lives in
 * @retrospend/domain/envelope/splits-input, shared with devices; here: the
 * reads.
 *
 * - your shares, through the one share definition every spending reader
 *   uses (`shareParticipations`: not rejected, outside projects you count
 *   "Not in budget"), over the whole history, since the replay needs every
 *   debt from its start;
 * - others' shares on splits you paid (any status: the cash left);
 * - payments to and from you;
 * - your project routing (D31) and your categories (D19).
 */
import type {
	MyShare,
	SplitInputs,
} from "@retrospend/domain/envelope/splits-input";
import type { Prisma } from "~prisma";
import {
	shareParticipations,
	shareRateResolver,
} from "../shared-expense-integration";
import { resolveClaimAliases } from "../shared-expenses/identity";
import { isDeviceRead } from "./load-state";
import type { PartyRef, SettlementRowIn, SplitPart } from "./split-events";

export {
	buildSplits,
	type LoadedSplits,
	type MyShare,
	type RouteRow,
	type SplitInputContext,
	type SplitInputRows,
	type SplitInputs,
	type UnsavedChoice,
} from "@retrospend/domain/envelope/splits-input";

type Tx = Prisma.TransactionClient;

const SPLIT_TX = {
	select: {
		id: true,
		currency: true,
		date: true,
		exchangeRate: true,
		projectId: true,
		paidByType: true,
		paidById: true,
	},
} as const;

const SETTLEMENT_SELECT = {
	id: true,
	fromParticipantType: true,
	fromParticipantId: true,
	toParticipantType: true,
	toParticipantId: true,
	amount: true,
	currency: true,
	convertedAmount: true,
	convertedCurrency: true,
	status: true,
	kind: true,
	isOffset: true,
	confirmedByPayer: true,
	confirmedByPayee: true,
	settledAt: true,
	initiatedAt: true,
	projectId: true,
	forgiveEnvelopeId: true,
	payment: { select: { paidOn: true } },
} as const;

async function loadRows(tx: Tx, userId: string, excluded: string[]) {
	const mine = await shareParticipations(tx, userId, undefined, excluded);
	const fronts = await tx.splitParticipant.findMany({
		where: {
			transaction: { paidByType: "user", paidById: userId },
			NOT: { participantType: "user", participantId: userId },
		},
		select: {
			id: true,
			participantType: true,
			participantId: true,
			shareAmount: true,
			verificationStatus: true,
			transaction: SPLIT_TX,
		},
	});
	const settlements = await tx.settlement.findMany({
		where: {
			status: { not: "REJECTED" },
			OR: [
				{ fromParticipantType: "user", fromParticipantId: userId },
				{ toParticipantType: "user", toParticipantId: userId },
			],
		},
		select: SETTLEMENT_SELECT,
	});
	const categories = await tx.category.findMany({
		where: { userId, kind: "EXPENSE" },
		select: { id: true },
	});
	return { mine, fronts, settlements, categories };
}

function refsOf(
	userId: string,
	rows: {
		mine: MyShare[];
		fronts: SplitPart[];
		settlements: SettlementRowIn[];
	},
): PartyRef[] {
	const refs: PartyRef[] = [{ participantType: "user", participantId: userId }];
	for (const p of rows.mine)
		refs.push({
			participantType: p.transaction.paidByType,
			participantId: p.transaction.paidById,
		});
	for (const p of rows.fronts) refs.push(p);
	for (const s of rows.settlements) {
		refs.push({
			participantType: s.fromParticipantType,
			participantId: s.fromParticipantId,
		});
		refs.push({
			participantType: s.toParticipantType,
			participantId: s.toParticipantId,
		});
	}
	return refs;
}

/** The dates the replay values a settlement on, for the batched rate lookup. */
function settlementRateRows(s: SettlementRowIn) {
	const date = s.payment?.paidOn ?? s.settledAt ?? s.initiatedAt;
	return [
		{ currency: s.currency, date, exchangeRate: null },
		...(s.convertedCurrency
			? [{ currency: s.convertedCurrency, date, exchangeRate: null }]
			: []),
	];
}

/** Reads every split row of `userId` (full history), with who is who and the stored rates. */
export async function loadSplitInputs(
	tx: Tx,
	userId: string,
): Promise<SplitInputs> {
	// A device never gets a project's name (readingForDevice): not read, so not opened.
	const names = !isDeviceRead();
	const found = await tx.projectParticipant.findMany({
		where: { participantType: "user", participantId: userId },
		select: {
			projectId: true,
			budgetRouting: true,
			budgetEnvelopeId: true,
			...(names ? { project: { select: { name: true } } } : {}),
		},
	});
	const routes = found.map((r) => ({
		projectId: r.projectId,
		budgetRouting: r.budgetRouting,
		budgetEnvelopeId: r.budgetEnvelopeId,
		project: { name: "project" in r ? r.project.name : "" },
	}));
	const excluded = routes
		.filter((r) => r.budgetRouting === "NOT_IN_BUDGET")
		.map((r) => r.projectId);
	const rows = await loadRows(tx, userId, excluded);
	const { canonicalKey } = await resolveClaimAliases(tx, refsOf(userId, rows));
	const rateFor = await shareRateResolver(tx, [
		...rows.mine.map((p) => p.transaction),
		...rows.fronts.map((p) => p.transaction),
		...rows.settlements.flatMap(settlementRateRows),
	]);
	return {
		userId,
		rows: { ...rows, routes },
		key: (ref) => canonicalKey(ref),
		rate: (row) => {
			const r = rateFor(row);
			// Decimal(18,6) rates round-trip exactly through a JS number's shortest form.
			return r === null ? null : String(r);
		},
	};
}
