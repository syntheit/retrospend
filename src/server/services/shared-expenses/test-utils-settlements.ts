/**
 * The settlement and payment models of the stateful in-memory DB
 * (test-utils.ts), kept apart so each file stays under its size limit.
 * They share the stores createStatefulDb owns.
 */
import { vi } from "vitest";

export interface SettlementRecord {
	id: string;
	fromParticipantType: string;
	fromParticipantId: string;
	toParticipantType: string;
	toParticipantId: string;
	amount: number;
	currency: string;
	status: string;
	confirmedByPayer: boolean;
	confirmedByPayee: boolean;
	initiatedAt: Date;
	settledAt: Date | null;
	convertedAmount: number | null;
	convertedCurrency: string | null;
	exchangeRateUsed: number | null;
	paymentMethod: string | null;
	note: string | null;
	projectId: string | null;
	autoConfirmedReason?: string | null;
	paymentGroupId?: string | null;
	isOffset?: boolean;
	rejectedAt?: Date | null;
	rejectedReason?: string | null;
	reminderCount?: number;
	reminderSentAt?: Date | null;
	kind?: string;
	rateType?: string | null;
}

/** A payment header (payments_corrections); its id is the rows' paymentGroupId. */
export interface PaymentRecord {
	id: string;
	payerType: string;
	payerId: string;
	payeeType: string;
	payeeId: string;
	amount: number | string;
	currency: string;
	rateType: string | null;
	rate: string | null;
	rateCurrency: string | null;
	paymentMethod: string | null;
	paidOn: Date;
	note: string | null;
	recordedByType: string;
	recordedById: string;
	status: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface SettlementModelDeps {
	settlements: Map<string, SettlementRecord>;
	payments: Map<string, PaymentRecord>;
	projects: ReadonlyMap<string, { id: string; name: string }>;
	nextId: () => string;
}

export function createSettlementModels({
	settlements,
	payments,
	projects,
	nextId,
}: SettlementModelDeps) {
	// ── settlement model ─────────────────────────────────────────────────────

	// where for updateMany/deleteMany: { id: { in } } and a status filter.
	const settlementWhereMatches = (
		s: SettlementRecord,
		where: Record<string, unknown>,
	) => {
		const idIn = (where.id as { in?: string[] } | undefined)?.in;
		if (idIn !== undefined && !idIn.includes(s.id)) return false;
		if (typeof where.id === "string" && s.id !== where.id) return false;
		const statusIn = (where.status as { in?: string[] } | undefined)?.in;
		if (statusIn !== undefined && !statusIn.includes(s.status)) return false;
		if (typeof where.status === "string" && s.status !== where.status)
			return false;
		if (
			where.paymentGroupId !== undefined &&
			s.paymentGroupId !== where.paymentGroupId
		)
			return false;
		if (
			where.isOffset !== undefined &&
			(s.isOffset ?? false) !== where.isOffset
		)
			return false;
		return true;
	};

	const settlementModel = {
		create: vi.fn((args: { data: Partial<SettlementRecord> }) => {
			const id = nextId();
			const record: SettlementRecord = {
				id,
				fromParticipantType: args.data.fromParticipantType ?? "user",
				fromParticipantId: args.data.fromParticipantId ?? "",
				toParticipantType: args.data.toParticipantType ?? "user",
				toParticipantId: args.data.toParticipantId ?? "",
				amount: args.data.amount ?? 0,
				currency: args.data.currency ?? "USD",
				status: args.data.status ?? "PROPOSED",
				confirmedByPayer: args.data.confirmedByPayer ?? true,
				confirmedByPayee: args.data.confirmedByPayee ?? false,
				initiatedAt: args.data.initiatedAt ?? new Date(),
				settledAt: args.data.settledAt ?? null,
				convertedAmount: args.data.convertedAmount ?? null,
				convertedCurrency: args.data.convertedCurrency ?? null,
				exchangeRateUsed: args.data.exchangeRateUsed ?? null,
				paymentMethod: args.data.paymentMethod ?? null,
				note: args.data.note ?? null,
				projectId: args.data.projectId ?? null,
				autoConfirmedReason: args.data.autoConfirmedReason ?? null,
				paymentGroupId: args.data.paymentGroupId ?? null,
				isOffset: args.data.isOffset ?? false,
				kind: args.data.kind ?? "PAYMENT",
				rateType: args.data.rateType ?? null,
				rejectedAt: null,
				rejectedReason: null,
				reminderCount: 0,
				reminderSentAt: null,
			};
			settlements.set(id, record);
			return record;
		}),

		findUnique: vi.fn((args: { where: { id: string } }) => {
			return settlements.get(args.where.id) ?? null;
		}),

		findMany: vi.fn(
			(
				args: {
					where?: Record<string, unknown>;
					orderBy?: unknown;
					include?: { project?: unknown };
					select?: { payment?: unknown };
				} = {},
			) => {
				let results = [...settlements.values()];
				const w = args.where ?? {};

				if (w.paymentGroupId !== undefined)
					results = results.filter(
						(s) => s.paymentGroupId === w.paymentGroupId,
					);
				const idIn = (w.id as { in?: string[] } | undefined)?.in;
				if (idIn !== undefined)
					results = results.filter((s) => idIn.includes(s.id));

				const statusIn = (w.status as { in?: string[] } | undefined)?.in;
				if (statusIn !== undefined)
					results = results.filter((s) => statusIn.includes(s.status));
				if (w.status !== undefined && typeof w.status === "string")
					results = results.filter((s) => s.status === w.status);

				// Top-level OR over from/to participant refs (alias expansion).
				const sOr = w.OR as
					| Array<{
							fromParticipantType?: string;
							fromParticipantId?: string;
							toParticipantType?: string;
							toParticipantId?: string;
					  }>
					| undefined;
				if (sOr !== undefined)
					results = results.filter((s) =>
						sOr.some(
							(c) =>
								(c.fromParticipantType === undefined ||
									s.fromParticipantType === c.fromParticipantType) &&
								(c.fromParticipantId === undefined ||
									s.fromParticipantId === c.fromParticipantId) &&
								(c.toParticipantType === undefined ||
									s.toParticipantType === c.toParticipantType) &&
								(c.toParticipantId === undefined ||
									s.toParticipantId === c.toParticipantId),
						),
					);

				if (w.fromParticipantType !== undefined)
					results = results.filter(
						(s) => s.fromParticipantType === w.fromParticipantType,
					);
				if (w.fromParticipantId !== undefined)
					results = results.filter(
						(s) => s.fromParticipantId === w.fromParticipantId,
					);
				if (w.toParticipantType !== undefined)
					results = results.filter(
						(s) => s.toParticipantType === w.toParticipantType,
					);
				if (w.toParticipantId !== undefined)
					results = results.filter(
						(s) => s.toParticipantId === w.toParticipantId,
					);

				// Project scope. Semantics mirror computeBalance's projectScopeWhere:
				//   projectId absent (key not present) => no filter (GLOBAL)
				//   projectId: string => only that project's settlements
				//   projectId: null   => only project-less settlements
				// Use `"projectId" in w` so an explicit `null` is a real filter, not
				// "no filter". A `null` value would fail a `!== undefined` guard.
				if ("projectId" in w) {
					const wantProjectId = w.projectId as string | null;
					results = results.filter((s) => s.projectId === wantProjectId);
				}

				// Newest first, like the history query. Ties keep insertion order.
				const ob = args.orderBy as { initiatedAt?: string } | undefined;
				if (ob?.initiatedAt) {
					const dir = ob.initiatedAt === "desc" ? -1 : 1;
					results = [...results].sort(
						(a, b) => dir * (a.initiatedAt.getTime() - b.initiatedAt.getTime()),
					);
				}

				if (args.include?.project) {
					return results.map((s) => {
						const p = s.projectId ? projects.get(s.projectId) : undefined;
						return { ...s, project: p ? { id: p.id, name: p.name } : null };
					});
				}
				// The header's date, as balance queries select it.
				if (args.select?.payment) {
					return results.map((s) => {
						const header = s.paymentGroupId
							? payments.get(s.paymentGroupId)
							: undefined;
						return { ...s, payment: header ? { paidOn: header.paidOn } : null };
					});
				}
				return results;
			},
		),

		updateMany: vi.fn(
			(args: {
				where: Record<string, unknown>;
				data: Partial<SettlementRecord>;
			}) => {
				let count = 0;
				for (const [id, s] of settlements) {
					if (!settlementWhereMatches(s, args.where)) continue;
					settlements.set(id, { ...s, ...args.data });
					count++;
				}
				return { count };
			},
		),

		deleteMany: vi.fn((args: { where: Record<string, unknown> }) => {
			let count = 0;
			for (const [id, s] of settlements) {
				if (!settlementWhereMatches(s, args.where)) continue;
				settlements.delete(id);
				count++;
			}
			return { count };
		}),

		update: vi.fn(
			(args: { where: { id: string }; data: Partial<SettlementRecord> }) => {
				const s = settlements.get(args.where.id);
				if (!s) throw new Error(`Settlement ${args.where.id} not found`);
				const updated = { ...s, ...args.data };
				settlements.set(args.where.id, updated);
				return updated;
			},
		),

		delete: vi.fn((args: { where: { id: string } }) => {
			const s = settlements.get(args.where.id);
			settlements.delete(args.where.id);
			return s;
		}),

		count: vi.fn((args: { where?: Record<string, unknown> } = {}) => {
			const matchesClause = (
				s: SettlementRecord,
				clause: Record<string, unknown>,
			) =>
				(clause.fromParticipantType === undefined ||
					s.fromParticipantType === clause.fromParticipantType) &&
				(clause.fromParticipantId === undefined ||
					s.fromParticipantId === clause.fromParticipantId) &&
				(clause.toParticipantType === undefined ||
					s.toParticipantType === clause.toParticipantType) &&
				(clause.toParticipantId === undefined ||
					s.toParticipantId === clause.toParticipantId);

			let count = 0;
			for (const s of settlements.values()) {
				const w = args.where;
				let matches = true;
				if (w?.OR) {
					const orClauses = w.OR as Array<Record<string, unknown>>;
					matches = orClauses.some((clause) => matchesClause(s, clause));
				} else if (w) {
					matches = matchesClause(s, w);
				}
				if (matches) count++;
			}
			return count;
		}),
	};

	// ── payment model (headers) ──────────────────────────────────────────────

	const paymentMatches = (
		p: PaymentRecord,
		where: Record<string, unknown> = {},
	): boolean => {
		const idIn = (where.id as { in?: string[] } | undefined)?.in;
		if (idIn !== undefined && !idIn.includes(p.id)) return false;
		if (typeof where.id === "string" && p.id !== where.id) return false;
		for (const field of [
			"status",
			"payerType",
			"payerId",
			"payeeType",
			"payeeId",
		] as const) {
			if (typeof where[field] === "string" && p[field] !== where[field])
				return false;
		}
		const or = where.OR as Array<Record<string, unknown>> | undefined;
		if (or && !or.some((clause) => paymentMatches(p, clause))) return false;
		return true;
	};

	const paymentModel = {
		create: vi.fn((args: { data: Partial<PaymentRecord> & { id: string } }) => {
			const now = new Date();
			const record: PaymentRecord = {
				payerType: "user",
				payerId: "",
				payeeType: "user",
				payeeId: "",
				amount: 0,
				currency: "USD",
				rateType: null,
				rate: null,
				rateCurrency: null,
				paymentMethod: null,
				paidOn: now,
				note: null,
				recordedByType: "user",
				recordedById: "",
				status: "PROPOSED",
				createdAt: now,
				updatedAt: now,
				...args.data,
			};
			payments.set(record.id, record);
			return record;
		}),
		findUnique: vi.fn(
			(args: { where: { id: string } }) => payments.get(args.where.id) ?? null,
		),
		findMany: vi.fn((args: { where?: Record<string, unknown> } = {}) =>
			[...payments.values()].filter((p) => paymentMatches(p, args.where)),
		),
		update: vi.fn(
			(args: { where: { id: string }; data: Partial<PaymentRecord> }) => {
				const p = payments.get(args.where.id);
				if (!p) throw new Error(`Payment ${args.where.id} not found`);
				const updated = { ...p, ...args.data, updatedAt: new Date() };
				payments.set(p.id, updated);
				return updated;
			},
		),
		updateMany: vi.fn(
			(args: {
				where: Record<string, unknown>;
				data: Partial<PaymentRecord>;
			}) => {
				let count = 0;
				for (const p of payments.values()) {
					if (!paymentMatches(p, args.where)) continue;
					payments.set(p.id, { ...p, ...args.data });
					count++;
				}
				return { count };
			},
		),
		// Deleting a header deletes its rows (ON DELETE CASCADE).
		deleteMany: vi.fn((args: { where: Record<string, unknown> }) => {
			let count = 0;
			for (const p of [...payments.values()]) {
				if (!paymentMatches(p, args.where)) continue;
				payments.delete(p.id);
				for (const [id, row] of settlements) {
					if (row.paymentGroupId === p.id) settlements.delete(id);
				}
				count++;
			}
			return { count };
		}),
	};
	return { settlementModel, paymentModel };
}
