/**
 * Stateful in-memory mock DB factory for integration tests.
 *
 * Both `db` and the `tx` passed inside `$transaction` share the same underlying
 * in-memory stores, so multi-step flows work correctly across service calls.
 *
 * Each store is a plain Map; tests can inspect `db._stores` for assertions.
 * Call `createStatefulDb()` fresh for each test to get isolated state.
 */

import { vi } from "vitest";

// ── Record types (minimal fields needed by the services) ─────────────────────

export interface TxRecord {
	id: string;
	description: string;
	amount: number;
	currency: string;
	date: Date;
	paidByType: string;
	paidById: string;
	createdByType: string;
	createdById: string;
	splitMode: string;
	projectId: string | null;
	billingPeriodId: string | null;
	isLocked: boolean;
	notes: string | null;
	receiptUrl: string | null;
	categoryId: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface SplitRecord {
	id: string;
	transactionId: string;
	participantType: string;
	participantId: string;
	shareAmount: number;
	sharePercentage: number | null;
	shareUnits: number | null;
	verificationStatus: string;
	verifiedAt: Date | null;
	rejectionReason: string | null;
	hasUnseenChanges: boolean;
}

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
}

export interface ProjectRecord {
	id: string;
	name: string;
	type: string;
	status: string;
	description: string | null;
	primaryCurrency: string;
	createdById: string;
	billingCycleLength: string | null;
	billingCycleDays: number | null;
	billingAutoClose: boolean;
	billingCloseReminderDays: number;
	billingClosePermission: string;
	visibility: string;
	startDate: Date | null;
	endDate: Date | null;
	budgetAmount: number | null;
	budgetCurrency: string | null;
	updatedAt: Date;
}

export interface BillingPeriodRecord {
	id: string;
	projectId: string;
	label: string;
	startDate: Date;
	endDate: Date;
	status: string;
	closedAt: Date | null;
	closedById: string | null;
	settledAt: Date | null;
}

export interface ProjectParticipantRecord {
	id: string;
	projectId: string;
	participantType: string;
	participantId: string;
	role: string;
	joinedAt: Date;
}

export interface MagicLinkRecord {
	id: string;
	projectId: string;
	roleGranted: string;
	createdById: string;
	expiresAt: Date | null;
	maxUses: number | null;
	useCount: number;
	isActive: boolean;
	createdAt: Date;
}

export interface GuestSessionRecord {
	id: string;
	name: string;
	email: string;
	magicLinkId: string;
	projectId: string;
	sessionToken: string;
	lastActiveAt: Date;
	createdAt: Date;
}

export interface UserRecord {
	id: string;
	name: string | null;
	email: string;
	image: string | null;
	username: string | null;
}

export interface ShadowProfileRecord {
	id: string;
	name: string;
	email: string | null;
	phone: string | null;
	createdById: string;
	claimedById: string | null;
}

// ── Main factory ──────────────────────────────────────────────────────────────

export function createStatefulDb() {
	// In-memory stores shared by db and all transaction clients
	const transactions = new Map<string, TxRecord>();
	const splits = new Map<string, SplitRecord>();
	const settlements = new Map<string, SettlementRecord>();
	const audits: unknown[] = [];
	const projects = new Map<string, ProjectRecord>();
	const billingPeriods = new Map<string, BillingPeriodRecord>();
	const projectParticipants = new Map<string, ProjectParticipantRecord>();
	const magicLinks = new Map<string, MagicLinkRecord>();
	const guestSessions = new Map<string, GuestSessionRecord>();
	const users = new Map<string, UserRecord>();
	const shadowProfiles = new Map<string, ShadowProfileRecord>();

	let seq = 0;
	const nextId = () => `mock-id-${++seq}`;

	// ── sharedTransaction model ──────────────────────────────────────────────

	const sharedTransactionModel = {
		create: vi.fn(
			(args: {
				data: Record<string, unknown>;
				include?: Record<string, unknown>;
			}) => {
				const id = nextId();
				const splitData =
					(
						args.data.splitParticipants as
							| { create?: Record<string, unknown>[] }
							| undefined
					)?.create ?? [];
				const createdSplits = splitData.map((sp) => {
					const spId = nextId();
					const record: SplitRecord = {
						id: spId,
						transactionId: id,
						participantType: sp.participantType as string,
						participantId: sp.participantId as string,
						shareAmount: sp.shareAmount as number,
						sharePercentage: (sp.sharePercentage as number | null) ?? null,
						shareUnits: (sp.shareUnits as number | null) ?? null,
						verificationStatus: (sp.verificationStatus as string) ?? "PENDING",
						verifiedAt: (sp.verifiedAt as Date | null) ?? null,
						rejectionReason: null,
						hasUnseenChanges: false,
					};
					splits.set(spId, record);
					return record;
				});

				const record: TxRecord = {
					id,
					description: args.data.description as string,
					amount: args.data.amount as number,
					currency: args.data.currency as string,
					date: args.data.date as Date,
					paidByType: args.data.paidByType as string,
					paidById: args.data.paidById as string,
					createdByType: args.data.createdByType as string,
					createdById: args.data.createdById as string,
					splitMode: args.data.splitMode as string,
					projectId: (args.data.projectId as string | null) ?? null,
					billingPeriodId: (args.data.billingPeriodId as string | null) ?? null,
					isLocked: false,
					notes: (args.data.notes as string | null) ?? null,
					receiptUrl: (args.data.receiptUrl as string | null) ?? null,
					categoryId: (args.data.categoryId as string | null) ?? null,
					createdAt: new Date(),
					updatedAt: new Date(),
				};
				transactions.set(id, record);

				const result = { ...record, splitParticipants: undefined as unknown };
				if (args.include?.splitParticipants) {
					result.splitParticipants = createdSplits;
				}
				return result;
			},
		),

		findUnique: vi.fn(
			(args: { where: { id: string }; include?: Record<string, unknown> }) => {
				const tx = transactions.get(args.where.id);
				if (!tx) return null;
				if (args.include?.splitParticipants) {
					const txSplits = [...splits.values()].filter(
						(sp) => sp.transactionId === tx.id,
					);
					return { ...tx, splitParticipants: txSplits };
				}
				return tx;
			},
		),

		findUniqueOrThrow: vi.fn(
			(args: { where: { id: string }; include?: Record<string, unknown> }) => {
				const tx = transactions.get(args.where.id);
				if (!tx) {
					const err = new Error("Transaction not found");
					(err as { code?: string }).code = "NOT_FOUND";
					throw err;
				}
				if (args.include?.splitParticipants) {
					const txSplits = [...splits.values()].filter(
						(sp) => sp.transactionId === tx.id,
					);
					return { ...tx, splitParticipants: txSplits };
				}
				return tx;
			},
		),

		update: vi.fn(
			(args: { where: { id: string }; data: Partial<TxRecord> }) => {
				const tx = transactions.get(args.where.id);
				if (!tx) throw new Error(`Transaction ${args.where.id} not found`);
				const updated = { ...tx, ...args.data, updatedAt: new Date() };
				transactions.set(args.where.id, updated);
				return updated;
			},
		),

		updateMany: vi.fn(
			(args: { where: Record<string, unknown>; data: Partial<TxRecord> }) => {
				let count = 0;
				for (const [id, tx] of transactions) {
					let matches = true;
					if (
						args.where.billingPeriodId !== undefined &&
						tx.billingPeriodId !== args.where.billingPeriodId
					)
						matches = false;
					if (matches) {
						transactions.set(id, {
							...tx,
							...args.data,
							updatedAt: new Date(),
						});
						count++;
					}
				}
				return { count };
			},
		),

		delete: vi.fn((args: { where: { id: string } }) => {
			const tx = transactions.get(args.where.id);
			transactions.delete(args.where.id);
			// Cascade-delete related splits
			for (const [spId, sp] of splits) {
				if (sp.transactionId === args.where.id) splits.delete(spId);
			}
			return tx;
		}),

		count: vi.fn((args: { where?: Record<string, unknown> } = {}) => {
			if (!args.where) return transactions.size;

			// Handle AND with nested splitParticipants.some (used by SettlementService)
			if (Array.isArray(args.where.AND)) {
				let count = 0;
				for (const tx of transactions.values()) {
					const txSplits = [...splits.values()].filter(
						(sp) => sp.transactionId === tx.id,
					);
					const allMatch = (
						args.where.AND as Array<Record<string, unknown>>
					).every((clause) => {
						const spSome = (
							clause.splitParticipants as
								| { some?: Record<string, unknown> }
								| undefined
						)?.some;
						if (spSome) {
							return txSplits.some(
								(sp) =>
									sp.participantType === spSome.participantType &&
									sp.participantId === spSome.participantId,
							);
						}
						return true;
					});
					if (allMatch) count++;
				}
				return count;
			}
			return transactions.size;
		}),

		aggregate: vi.fn(() => ({ _sum: { amount: 0 } })),

		findMany: vi.fn(
			(
				args: {
					where?: Record<string, unknown>;
					select?: Record<string, unknown>;
					orderBy?: unknown;
					skip?: number;
					take?: number;
				} = {},
			) => {
				// Helper: check if a split matches a filter condition
				const matchesSplitCond = (
					sp: SplitRecord,
					cond: Record<string, unknown>,
				) =>
					(cond.participantType === undefined ||
						sp.participantType === cond.participantType) &&
					(cond.participantId === undefined ||
						sp.participantId === cond.participantId) &&
					(cond.verificationStatus === undefined ||
						sp.verificationStatus === cond.verificationStatus);

				// Helper: check if a transaction matches a where clause (recursive for AND)
				const matchesTx = (
					tx: TxRecord,
					where: Record<string, unknown>,
				): boolean => {
					if (where.splitParticipants) {
						const spFilter = where.splitParticipants as {
							some?: Record<string, unknown>;
							none?: Record<string, unknown>;
						};
						const txSplits = [...splits.values()].filter(
							(sp) => sp.transactionId === tx.id,
						);
						if (
							spFilter.some &&
							!txSplits.some((sp) => matchesSplitCond(sp, spFilter.some!))
						)
							return false;
						if (
							spFilter.none &&
							txSplits.some((sp) => matchesSplitCond(sp, spFilter.none!))
						)
							return false;
					}
					if (where.AND) {
						const andClauses = where.AND as Array<Record<string, unknown>>;
						if (!andClauses.every((clause) => matchesTx(tx, clause)))
							return false;
					}
					if (where.isLocked !== undefined && tx.isLocked !== where.isLocked)
						return false;
					if (where.projectId !== undefined && tx.projectId !== where.projectId)
						return false;
					return true;
				};

				let results = [...transactions.values()];
				if (args.where) {
					results = results.filter((tx) => matchesTx(tx, args.where!));
				}

				// orderBy date
				if (
					args.orderBy &&
					typeof args.orderBy === "object" &&
					!Array.isArray(args.orderBy)
				) {
					const ob = args.orderBy as Record<string, string>;
					if (ob.date) {
						results = [...results].sort((a, b) => {
							const diff = a.date.getTime() - b.date.getTime();
							return ob.date === "desc" ? -diff : diff;
						});
					}
				}

				// pagination
				if (args.skip !== undefined) results = results.slice(args.skip);
				if (args.take !== undefined) results = results.slice(0, args.take);

				// apply select
				if (args.select) {
					const sel = args.select;
					return results.map((tx) => {
						const txSplits = [...splits.values()].filter(
							(sp) => sp.transactionId === tx.id,
						);
						const out: Record<string, unknown> = {};
						if (sel.id) out.id = tx.id;
						if (sel.description) out.description = tx.description;
						if (sel.amount) out.amount = tx.amount;
						if (sel.currency) out.currency = tx.currency;
						if (sel.date) out.date = tx.date;
						if (sel.isLocked !== undefined) out.isLocked = tx.isLocked;
						if (sel.paidByType) out.paidByType = tx.paidByType;
						if (sel.paidById) out.paidById = tx.paidById;
						if (sel.projectId !== undefined) out.projectId = tx.projectId;
						if (sel.project !== undefined) {
							if (tx.projectId) {
								const p = projects.get(tx.projectId);
								out.project = p ? { id: p.id, name: p.name } : null;
							} else {
								out.project = null;
							}
						}
						if (sel.category !== undefined) out.category = null; // categories not mocked
						if (sel.splitParticipants) {
							const spSel = (
								sel.splitParticipants as { select?: Record<string, unknown> }
							).select;
							out.splitParticipants = spSel
								? txSplits.map((sp) => {
										const spOut: Record<string, unknown> = {};
										if (spSel.participantType)
											spOut.participantType = sp.participantType;
										if (spSel.participantId)
											spOut.participantId = sp.participantId;
										if (spSel.verificationStatus)
											spOut.verificationStatus = sp.verificationStatus;
										if (spSel.shareAmount) spOut.shareAmount = sp.shareAmount;
										return spOut;
									})
								: txSplits;
						}
						return out;
					});
				}

				return results;
			},
		),
	};

	// ── splitParticipant model ───────────────────────────────────────────────

	const splitParticipantModel = {
		findMany: vi.fn(
			(
				args: {
					where?: Record<string, unknown>;
					select?: Record<string, unknown>;
					include?: Record<string, unknown>;
					orderBy?: unknown;
				} = {},
			) => {
				let results = [...splits.values()];

				if (args.where) {
					const w = args.where;
					results = results.filter((sp) => {
						if (
							w.participantType !== undefined &&
							sp.participantType !== w.participantType
						)
							return false;
						if (
							w.participantId !== undefined &&
							sp.participantId !== w.participantId
						)
							return false;
						if (
							w.verificationStatus !== undefined &&
							sp.verificationStatus !== w.verificationStatus
						)
							return false;

						const idIn = (w.id as { in?: string[] } | undefined)?.in;
						if (idIn !== undefined && !idIn.includes(sp.id)) return false;

						// Nested transaction filter (for computeBalance)
						if (w.transaction) {
							const txFilter = w.transaction as Record<string, unknown>;
							const tx = transactions.get(sp.transactionId);
							if (!tx) return false;
							if (
								txFilter.paidByType !== undefined &&
								tx.paidByType !== txFilter.paidByType
							)
								return false;
							if (
								txFilter.paidById !== undefined &&
								tx.paidById !== txFilter.paidById
							)
								return false;
							// createdAt filter for auto-accept expiry
							const createdAtFilter = txFilter.createdAt as
								| { lt?: Date }
								| undefined;
							if (createdAtFilter?.lt !== undefined) {
								if (!(tx.createdAt < createdAtFilter.lt)) return false;
							}
							if (
								txFilter.billingPeriodId !== undefined &&
								tx.billingPeriodId !== txFilter.billingPeriodId
							)
								return false;
						}

						return true;
					});
				}

				// Apply select transforms (for computeBalance)
				if (args.select) {
					const sel = args.select;
					return results.map((sp) => {
						const tx = transactions.get(sp.transactionId);
						const out: Record<string, unknown> = {};
						if (sel.shareAmount) out.shareAmount = sp.shareAmount;
						if (sel.transaction)
							out.transaction = { currency: tx?.currency ?? "USD" };
						if (sel.id) out.id = sp.id;
						if (sel.participantType) out.participantType = sp.participantType;
						if (sel.participantId) out.participantId = sp.participantId;
						if (sel.verificationStatus)
							out.verificationStatus = sp.verificationStatus;
						if (sel.shareAmount !== undefined) out.shareAmount = sp.shareAmount;
						return out;
					});
				}

				// Include nested transaction (for verification service getQueue)
				if (args.include?.transaction) {
					return results.map((sp) => {
						const tx = transactions.get(sp.transactionId);
						const incl = args.include!.transaction as Record<string, unknown>;
						let txData: unknown = tx;
						if (
							(incl.include as Record<string, unknown> | undefined)
								?.splitParticipants
						) {
							const txSplits = [...splits.values()].filter(
								(s) => s.transactionId === sp.transactionId,
							);
							txData = tx ? { ...tx, splitParticipants: txSplits } : null;
						}
						return { ...sp, transaction: txData };
					});
				}

				return results;
			},
		),

		update: vi.fn(
			(args: { where: { id: string }; data: Partial<SplitRecord> }) => {
				const sp = splits.get(args.where.id);
				if (!sp) throw new Error(`Split ${args.where.id} not found`);
				const updated = { ...sp, ...args.data };
				splits.set(args.where.id, updated);
				return updated;
			},
		),

		updateMany: vi.fn(
			(args: {
				where: Record<string, unknown>;
				data: Partial<SplitRecord>;
			}) => {
				let count = 0;
				const w = args.where;
				for (const [id, sp] of splits) {
					let matches = true;
					if (
						w.transactionId !== undefined &&
						sp.transactionId !== w.transactionId
					)
						matches = false;
					const idIn = (w.id as { in?: string[] } | undefined)?.in;
					if (idIn !== undefined && !idIn.includes(id)) matches = false;

					const notClause = w.NOT as
						| { participantType?: string; participantId?: string }
						| undefined;
					if (
						notClause?.participantType !== undefined &&
						notClause?.participantId !== undefined &&
						sp.participantType === notClause.participantType &&
						sp.participantId === notClause.participantId
					)
						matches = false;

					if (
						w.verificationStatus !== undefined &&
						typeof w.verificationStatus === "string" &&
						sp.verificationStatus !== w.verificationStatus
					)
						matches = false;

					const vsIn = (w.verificationStatus as { in?: string[] } | undefined)
						?.in;
					if (vsIn !== undefined && !vsIn.includes(sp.verificationStatus))
						matches = false;

					if (
						w.participantType !== undefined &&
						sp.participantType !== w.participantType
					)
						matches = false;
					if (
						w.participantId !== undefined &&
						sp.participantId !== w.participantId
					)
						matches = false;
					if (
						w.hasUnseenChanges !== undefined &&
						sp.hasUnseenChanges !== w.hasUnseenChanges
					)
						matches = false;

					if (matches) {
						splits.set(id, { ...sp, ...args.data });
						count++;
					}
				}
				return { count };
			},
		),

		deleteMany: vi.fn((args: { where: Record<string, unknown> }) => {
			let count = 0;
			for (const [id, sp] of splits) {
				if (
					args.where.transactionId !== undefined &&
					sp.transactionId !== args.where.transactionId
				)
					continue;
				splits.delete(id);
				count++;
			}
			return { count };
		}),

		createMany: vi.fn(
			(args: {
				data: Array<Partial<SplitRecord> & { transactionId: string }>;
			}) => {
				for (const item of args.data) {
					const id = nextId();
					splits.set(id, {
						id,
						transactionId: item.transactionId,
						participantType: item.participantType ?? "user",
						participantId: item.participantId ?? "",
						shareAmount: item.shareAmount ?? 0,
						sharePercentage: item.sharePercentage ?? null,
						shareUnits: item.shareUnits ?? null,
						verificationStatus: item.verificationStatus ?? "PENDING",
						verifiedAt: item.verifiedAt ?? null,
						rejectionReason: null,
						hasUnseenChanges: (item.hasUnseenChanges as boolean | undefined) ?? false,
					});
				}
				return { count: args.data.length };
			},
		),

		count: vi.fn((args: { where?: Record<string, unknown> } = {}) => {
			if (!args.where) return splits.size;
			let count = 0;
			const w = args.where;
			for (const sp of splits.values()) {
				let matches = true;
				if (
					w.participantType !== undefined &&
					sp.participantType !== w.participantType
				)
					matches = false;
				if (
					w.participantId !== undefined &&
					sp.participantId !== w.participantId
				)
					matches = false;
				if (
					w.verificationStatus !== undefined &&
					typeof w.verificationStatus === "string" &&
					sp.verificationStatus !== w.verificationStatus
				)
					matches = false;
				const vsIn = (w.verificationStatus as { in?: string[] } | undefined)
					?.in;
				if (vsIn !== undefined && !vsIn.includes(sp.verificationStatus))
					matches = false;

				if (w.transaction) {
					const txFilter = w.transaction as Record<string, unknown>;
					const tx = transactions.get(sp.transactionId);
					if (!tx) {
						matches = false;
					} else if (
						txFilter.billingPeriodId !== undefined &&
						tx.billingPeriodId !== txFilter.billingPeriodId
					)
						matches = false;
				}
				if (matches) count++;
			}
			return count;
		}),
	};

	// ── settlement model ─────────────────────────────────────────────────────

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
				initiatedAt: new Date(),
				settledAt: null,
				convertedAmount: args.data.convertedAmount ?? null,
				convertedCurrency: args.data.convertedCurrency ?? null,
				exchangeRateUsed: args.data.exchangeRateUsed ?? null,
				paymentMethod: args.data.paymentMethod ?? null,
				note: args.data.note ?? null,
			};
			settlements.set(id, record);
			return record;
		}),

		findUnique: vi.fn((args: { where: { id: string } }) => {
			return settlements.get(args.where.id) ?? null;
		}),

		findMany: vi.fn(
			(args: { where?: Record<string, unknown>; orderBy?: unknown } = {}) => {
				let results = [...settlements.values()];
				const w = args.where ?? {};

				if (w.status !== undefined && typeof w.status === "string")
					results = results.filter((s) => s.status === w.status);
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

				return results;
			},
		),

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
	};

	// ── auditLogEntry model ──────────────────────────────────────────────────

	const auditLogEntryModel = {
		create: vi.fn((args: { data: Record<string, unknown> }) => {
			const entry = { id: nextId(), ...args.data, createdAt: new Date() };
			audits.push(entry);
			return entry;
		}),
	};

	// ── shadowProfile model ──────────────────────────────────────────────────

	const shadowProfileModel = {
		findUnique: vi.fn((args: { where: { id: string }; select?: unknown }) => {
			return shadowProfiles.get(args.where.id) ?? null;
		}),
		findMany: vi.fn(
			(args: { where?: Record<string, unknown>; select?: unknown } = {}) => {
				return [...shadowProfiles.values()].filter((sp) => {
					if (
						args.where?.id &&
						typeof args.where.id === "object" &&
						(args.where.id as { in?: string[] }).in
					) {
						return (args.where.id as { in: string[] }).in.includes(sp.id);
					}
					return true;
				});
			},
		),
		create: vi.fn(
			(args: { data: Partial<ShadowProfileRecord>; select?: unknown }) => {
				const id = nextId();
				const record: ShadowProfileRecord = {
					id,
					name: args.data.name ?? "Shadow User",
					email: args.data.email ?? null,
					phone: args.data.phone ?? null,
					createdById: args.data.createdById ?? "",
					claimedById: null,
				};
				shadowProfiles.set(id, record);
				return record;
			},
		),
	};

	// ── project model ────────────────────────────────────────────────────────

	const projectModel = {
		findUnique: vi.fn(
			(args: {
				where: { id: string };
				select?: unknown;
				include?: unknown;
			}) => {
				const p = projects.get(args.where.id);
				if (!p) return null;
				// For include: { participants: true, billingPeriods: true }
				const incl = args.include as Record<string, unknown> | undefined;
				if (incl) {
					const result: Record<string, unknown> = { ...p };
					if (incl.participants) {
						result.participants = [...projectParticipants.values()].filter(
							(pp) => pp.projectId === p.id,
						);
					}
					if (incl.billingPeriods) {
						result.billingPeriods = [...billingPeriods.values()].filter(
							(bp) => bp.projectId === p.id,
						);
					}
					return result;
				}
				return p;
			},
		),
		findUniqueOrThrow: vi.fn(
			(args: { where: { id: string }; select?: unknown }) => {
				const p = projects.get(args.where.id);
				if (!p) throw new Error(`Project ${args.where.id} not found`);
				return p;
			},
		),
		create: vi.fn(
			(args: { data: Partial<ProjectRecord>; include?: unknown }) => {
				const id = nextId();
				const record: ProjectRecord = {
					id,
					name: args.data.name ?? "Test Project",
					type: args.data.type ?? "GENERAL",
					status: "ACTIVE",
					description: args.data.description ?? null,
					primaryCurrency: args.data.primaryCurrency ?? "USD",
					createdById: args.data.createdById ?? "",
					billingCycleLength: args.data.billingCycleLength ?? null,
					billingCycleDays: args.data.billingCycleDays ?? null,
					billingAutoClose: args.data.billingAutoClose ?? false,
					billingCloseReminderDays: args.data.billingCloseReminderDays ?? 3,
					billingClosePermission:
						args.data.billingClosePermission ?? "ORGANIZER_ONLY",
					visibility: args.data.visibility ?? "PRIVATE",
					startDate: args.data.startDate ?? null,
					endDate: args.data.endDate ?? null,
					budgetAmount: args.data.budgetAmount ?? null,
					budgetCurrency: args.data.budgetCurrency ?? null,
					updatedAt: new Date(),
				};
				projects.set(id, record);
				return record;
			},
		),
	};

	// ── billingPeriod model ──────────────────────────────────────────────────

	const billingPeriodModel = {
		findFirst: vi.fn(
			(args: { where?: Record<string, unknown>; orderBy?: unknown } = {}) => {
				for (const bp of billingPeriods.values()) {
					if (args.where?.projectId && bp.projectId !== args.where.projectId)
						continue;
					if (
						args.where?.status !== undefined &&
						typeof args.where.status === "string" &&
						bp.status !== args.where.status
					)
						continue;
					return bp;
				}
				return null;
			},
		),
		findMany: vi.fn(
			(args: { where?: Record<string, unknown>; orderBy?: unknown } = {}) => {
				let results = [...billingPeriods.values()];
				if (args.where?.projectId)
					results = results.filter(
						(bp) => bp.projectId === args.where!.projectId,
					);
				if (
					args.where?.status !== undefined &&
					typeof args.where.status === "string"
				)
					results = results.filter((bp) => bp.status === args.where!.status);
				return results;
			},
		),
		findUnique: vi.fn((args: { where: { id: string } }) => {
			return billingPeriods.get(args.where.id) ?? null;
		}),
		findUniqueOrThrow: vi.fn((args: { where: { id: string } }) => {
			const bp = billingPeriods.get(args.where.id);
			if (!bp) throw new Error(`BillingPeriod ${args.where.id} not found`);
			return bp;
		}),
		create: vi.fn((args: { data: Partial<BillingPeriodRecord> }) => {
			const id = nextId();
			const record: BillingPeriodRecord = {
				id,
				projectId: args.data.projectId ?? "",
				label: args.data.label ?? "",
				startDate: args.data.startDate ?? new Date(),
				endDate: args.data.endDate ?? new Date(),
				status: args.data.status ?? "OPEN",
				closedAt: null,
				closedById: null,
				settledAt: null,
			};
			billingPeriods.set(id, record);
			return record;
		}),
		update: vi.fn(
			(args: { where: { id: string }; data: Partial<BillingPeriodRecord> }) => {
				const bp = billingPeriods.get(args.where.id);
				if (!bp) throw new Error(`BillingPeriod ${args.where.id} not found`);
				const updated = { ...bp, ...args.data };
				billingPeriods.set(args.where.id, updated);
				return updated;
			},
		),
		updateMany: vi.fn(
			(args: {
				where: Record<string, unknown>;
				data: Partial<BillingPeriodRecord>;
			}) => {
				let count = 0;
				for (const [id, bp] of billingPeriods) {
					let matches = true;
					if (args.where.id !== undefined && id !== args.where.id)
						matches = false;
					if (
						args.where.status !== undefined &&
						typeof args.where.status === "string" &&
						bp.status !== args.where.status
					)
						matches = false;
					if (matches) {
						billingPeriods.set(id, { ...bp, ...args.data });
						count++;
					}
				}
				return { count };
			},
		),
	};

	// ── projectParticipant model ─────────────────────────────────────────────

	const projectParticipantModel = {
		findUnique: vi.fn((args: { where: Record<string, unknown> }) => {
			const composite = args.where.projectId_participantType_participantId as
				| Record<string, string>
				| undefined;
			if (composite) {
				for (const pp of projectParticipants.values()) {
					if (
						pp.projectId === composite.projectId &&
						pp.participantType === composite.participantType &&
						pp.participantId === composite.participantId
					)
						return pp;
				}
				return null;
			}
			return projectParticipants.get(args.where.id as string) ?? null;
		}),
		create: vi.fn((args: { data: Partial<ProjectParticipantRecord> }) => {
			const id = nextId();
			const record: ProjectParticipantRecord = {
				id,
				projectId: args.data.projectId ?? "",
				participantType: args.data.participantType ?? "user",
				participantId: args.data.participantId ?? "",
				role: args.data.role ?? "CONTRIBUTOR",
				joinedAt: new Date(),
			};
			projectParticipants.set(id, record);
			return record;
		}),
		upsert: vi.fn(
			(args: {
				where: Record<string, unknown>;
				create: Partial<ProjectParticipantRecord>;
				update: Partial<ProjectParticipantRecord>;
			}) => {
				const composite = args.where.projectId_participantType_participantId as
					| Record<string, string>
					| undefined;
				if (composite) {
					for (const pp of projectParticipants.values()) {
						if (
							pp.projectId === composite.projectId &&
							pp.participantType === composite.participantType &&
							pp.participantId === composite.participantId
						) {
							const updated = { ...pp, ...args.update };
							projectParticipants.set(pp.id, updated);
							return updated;
						}
					}
				}
				// Create
				const id = nextId();
				const record: ProjectParticipantRecord = {
					id,
					projectId: args.create.projectId ?? "",
					participantType: args.create.participantType ?? "user",
					participantId: args.create.participantId ?? "",
					role: args.create.role ?? "CONTRIBUTOR",
					joinedAt: new Date(),
				};
				projectParticipants.set(id, record);
				return record;
			},
		),
		findMany: vi.fn((args: { where?: Record<string, unknown> } = {}) => {
			let results = [...projectParticipants.values()];
			if (args.where?.projectId)
				results = results.filter(
					(pp) => pp.projectId === args.where!.projectId,
				);
			if (args.where?.participantType)
				results = results.filter(
					(pp) => pp.participantType === args.where!.participantType,
				);
			if (args.where?.participantId)
				results = results.filter(
					(pp) => pp.participantId === args.where!.participantId,
				);
			return results;
		}),
		delete: vi.fn((args: { where: { id: string } }) => {
			const pp = projectParticipants.get(args.where.id);
			projectParticipants.delete(args.where.id);
			return pp;
		}),
	};

	// ── magicLink model ──────────────────────────────────────────────────────

	const magicLinkModel = {
		findUnique: vi.fn(
			(args: { where: { id: string }; include?: Record<string, unknown> }) => {
				const link = magicLinks.get(args.where.id);
				if (!link) return null;
				if (args.include?.project) {
					const p = projects.get(link.projectId);
					const ppCount = [...projectParticipants.values()].filter(
						(pp) => pp.projectId === link.projectId,
					).length;
					return {
						...link,
						project: {
							id: link.projectId,
							name: p?.name ?? "Test Project",
							description: p?.description ?? null,
							_count: { participants: ppCount },
						},
					};
				}
				return link;
			},
		),
		create: vi.fn((args: { data: Partial<MagicLinkRecord> }) => {
			const record: MagicLinkRecord = {
				id: args.data.id ?? nextId(),
				projectId: args.data.projectId ?? "",
				roleGranted: args.data.roleGranted ?? "CONTRIBUTOR",
				createdById: args.data.createdById ?? "",
				expiresAt: args.data.expiresAt ?? null,
				maxUses: args.data.maxUses ?? null,
				useCount: 0,
				isActive: true,
				createdAt: new Date(),
			};
			magicLinks.set(record.id, record);
			return record;
		}),
		update: vi.fn(
			(args: { where: { id: string }; data: Record<string, unknown> }) => {
				const link = magicLinks.get(args.where.id);
				if (!link) throw new Error("Magic link not found");
				const updated = { ...link, ...args.data };
				// Handle { useCount: { increment: 1 } }
				const ucInc = (args.data.useCount as { increment?: number } | undefined)
					?.increment;
				if (ucInc !== undefined) {
					updated.useCount = link.useCount + ucInc;
				}
				magicLinks.set(args.where.id, updated);
				return updated;
			},
		),
	};

	// ── guestSession model ───────────────────────────────────────────────────

	const guestSessionModel = {
		findFirst: vi.fn((args: { where?: Record<string, unknown> } = {}) => {
			for (const gs of guestSessions.values()) {
				if (args.where?.email !== undefined && gs.email !== args.where.email)
					continue;
				if (
					args.where?.projectId !== undefined &&
					gs.projectId !== args.where.projectId
				)
					continue;
				return gs;
			}
			return null;
		}),
		findUnique: vi.fn((args: { where: { id: string } }) => {
			return guestSessions.get(args.where.id) ?? null;
		}),
		create: vi.fn((args: { data: Partial<GuestSessionRecord> }) => {
			const id = nextId();
			const record: GuestSessionRecord = {
				id,
				name: args.data.name ?? "Guest",
				email: args.data.email ?? "",
				magicLinkId: args.data.magicLinkId ?? "",
				projectId: args.data.projectId ?? "",
				sessionToken: args.data.sessionToken ?? "",
				lastActiveAt: new Date(),
				createdAt: new Date(),
			};
			guestSessions.set(id, record);
			return record;
		}),
		update: vi.fn(
			(args: { where: { id: string }; data: Partial<GuestSessionRecord> }) => {
				const gs = guestSessions.get(args.where.id);
				if (!gs) throw new Error("Guest session not found");
				const updated = { ...gs, ...args.data };
				guestSessions.set(args.where.id, updated);
				return updated;
			},
		),
	};

	// ── user model ───────────────────────────────────────────────────────────

	const userModel = {
		findUnique: vi.fn(
			(args: { where: Record<string, string>; select?: unknown }) => {
				for (const u of users.values()) {
					if (args.where.id !== undefined && u.id !== args.where.id) continue;
					if (args.where.email !== undefined && u.email !== args.where.email)
						continue;
					return u;
				}
				return null;
			},
		),
		findMany: vi.fn(() => [...users.values()]),
	};

	// ── Assemble the full interface ───────────────────────────────────────────

	const iface = {
		$executeRaw: vi.fn().mockResolvedValue(undefined),
		sharedTransaction: sharedTransactionModel,
		splitParticipant: splitParticipantModel,
		settlement: settlementModel,
		auditLogEntry: auditLogEntryModel,
		shadowProfile: shadowProfileModel,
		project: projectModel,
		billingPeriod: billingPeriodModel,
		projectParticipant: projectParticipantModel,
		magicLink: magicLinkModel,
		guestSession: guestSessionModel,
		user: userModel,
	};

	const db = {
		...iface,
		$transaction: vi.fn(async <T>(cb: (tx: typeof iface) => Promise<T>) => {
			return cb(iface);
		}),
		// Expose stores for test assertions
		_stores: {
			transactions,
			splits,
			settlements,
			audits,
			projects,
			billingPeriods,
			projectParticipants,
			magicLinks,
			guestSessions,
			users,
			shadowProfiles,
		},
	};

	return db;
}

/** Pre-populate a user in the stateful db and return their ref. */
export function addUser(
	db: ReturnType<typeof createStatefulDb>,
	overrides: Partial<UserRecord> & { id: string },
): UserRecord {
	const user: UserRecord = {
		name: overrides.name ?? "Test User",
		email: overrides.email ?? `${overrides.id}@example.com`,
		image: overrides.image ?? null,
		username: overrides.username ?? null,
		...overrides,
	};
	db._stores.users.set(user.id, user);
	return user;
}

/** Pre-populate a shadow profile in the stateful db and return its record. */
export function addShadowProfile(
	db: ReturnType<typeof createStatefulDb>,
	overrides: Partial<ShadowProfileRecord> & { createdById: string },
): ShadowProfileRecord {
	const id = `shadow-${db._stores.shadowProfiles.size + 1}`;
	const record: ShadowProfileRecord = {
		name: overrides.name ?? "Shadow User",
		email: overrides.email ?? null,
		phone: overrides.phone ?? null,
		claimedById: null,
		...overrides,
		id,
	};
	db._stores.shadowProfiles.set(id, record);
	return record;
}

/** Pre-populate a project in the stateful db and return its record. */
export function addProject(
	db: ReturnType<typeof createStatefulDb>,
	overrides: Partial<ProjectRecord> & { createdById: string },
): ProjectRecord {
	const id = `project-${db._stores.projects.size + 1}`;
	const record: ProjectRecord = {
		name: overrides.name ?? "Test Project",
		type: overrides.type ?? "GENERAL",
		status: "ACTIVE",
		description: overrides.description ?? null,
		primaryCurrency: overrides.primaryCurrency ?? "USD",
		billingCycleLength: overrides.billingCycleLength ?? null,
		billingCycleDays: overrides.billingCycleDays ?? null,
		billingAutoClose: overrides.billingAutoClose ?? false,
		billingCloseReminderDays: overrides.billingCloseReminderDays ?? 3,
		billingClosePermission:
			overrides.billingClosePermission ?? "ORGANIZER_ONLY",
		visibility: overrides.visibility ?? "PRIVATE",
		startDate: overrides.startDate ?? null,
		endDate: overrides.endDate ?? null,
		budgetAmount: overrides.budgetAmount ?? null,
		budgetCurrency: overrides.budgetCurrency ?? null,
		updatedAt: new Date(),
		...overrides,
		id,
	};
	db._stores.projects.set(id, record);
	return record;
}

/** Pre-populate a project participant in the stateful db. */
export function addProjectParticipant(
	db: ReturnType<typeof createStatefulDb>,
	data: {
		projectId: string;
		participantType: string;
		participantId: string;
		role: string;
	},
): ProjectParticipantRecord {
	const id = `pp-${db._stores.projectParticipants.size + 1}`;
	const record: ProjectParticipantRecord = {
		id,
		projectId: data.projectId,
		participantType: data.participantType,
		participantId: data.participantId,
		role: data.role,
		joinedAt: new Date(),
	};
	db._stores.projectParticipants.set(id, record);
	return record;
}

/** Pre-populate a billing period in the stateful db. */
export function addBillingPeriod(
	db: ReturnType<typeof createStatefulDb>,
	data: Partial<BillingPeriodRecord> & { projectId: string },
): BillingPeriodRecord {
	const id = `bp-${db._stores.billingPeriods.size + 1}`;
	const record: BillingPeriodRecord = {
		label: data.label ?? "March 2026",
		startDate: data.startDate ?? new Date("2026-03-01"),
		endDate: data.endDate ?? new Date("2026-03-31"),
		status: data.status ?? "OPEN",
		closedAt: data.closedAt ?? null,
		closedById: data.closedById ?? null,
		settledAt: data.settledAt ?? null,
		...data,
		id,
	};
	db._stores.billingPeriods.set(id, record);
	return record;
}

/** Pre-populate a magic link in the stateful db. */
export function addMagicLink(
	db: ReturnType<typeof createStatefulDb>,
	data: Partial<MagicLinkRecord> & { projectId: string; createdById: string },
): MagicLinkRecord {
	const id = `link-${db._stores.magicLinks.size + 1}`;
	const record: MagicLinkRecord = {
		roleGranted: data.roleGranted ?? "CONTRIBUTOR",
		expiresAt: data.expiresAt ?? null,
		maxUses: data.maxUses ?? null,
		useCount: data.useCount ?? 0,
		isActive: data.isActive ?? true,
		createdAt: new Date(),
		...data,
		id,
	};
	db._stores.magicLinks.set(id, record);
	return record;
}

/** Participant refs for convenience */
export const makeUserRef = (id: string) => ({
	participantType: "user" as const,
	participantId: id,
});
export const makeShadowRef = (id: string) => ({
	participantType: "shadow" as const,
	participantId: id,
});
export const makeGuestRef = (id: string) => ({
	participantType: "guest" as const,
	participantId: id,
});
