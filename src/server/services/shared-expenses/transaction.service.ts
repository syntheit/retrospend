import { TRPCError } from "@trpc/server";
import {
	createNotification,
	resolveParticipantName,
} from "~/server/services/notifications";
import type { Prisma, PrismaClient, SplitMode } from "~prisma";
import { logAudit } from "./audit-log";
import {
	assertCanModifyTransaction,
	requireProjectRole,
} from "./project-permissions";
import { type ParticipantRef, sameParticipant } from "./types";

type AppDb = PrismaClient;

interface SplitParticipantInput {
	participantType: "user" | "guest" | "shadow";
	participantId: string;
	shareAmount?: number;
	sharePercentage?: number;
	shareUnits?: number;
}

type SplitModeType = "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";

interface CreateSharedTransactionInput {
	amount: number;
	currency: string;
	description: string;
	categoryId?: string;
	date: Date;
	paidBy: ParticipantRef;
	splitWith: SplitParticipantInput[];
	splitMode: SplitModeType;
	projectId?: string;
	notes?: string;
	receiptUrl?: string;
}

interface UpdateSharedTransactionInput {
	id: string;
	amount?: number;
	currency?: string;
	description?: string;
	categoryId?: string | null;
	date?: Date;
	paidBy?: ParticipantRef;
	splitWith?: SplitParticipantInput[];
	splitMode?: SplitModeType;
	projectId?: string | null;
	notes?: string | null;
	receiptUrl?: string | null;
}

/**
 * Builds a concise human-readable summary of changes from a field-level diff.
 * Truncates after 3 fields to keep notification text brief.
 */
function buildChangeSummary(
	diff: Record<string, { old: unknown; new: unknown }>,
	oldCurrency: string,
	newCurrency: string,
): string | null {
	const keys = Object.keys(diff);
	if (keys.length === 0) return null;

	const MAX_FIELDS = 3;
	const parts: string[] = [];

	for (const key of keys) {
		if (parts.length >= MAX_FIELDS) break;
		const { old: oldVal, new: newVal } = diff[key]!;

		switch (key) {
			case "amount": {
				const oldAmt = Number(oldVal).toFixed(2);
				const newAmt = Number(newVal).toFixed(2);
				parts.push(`amount: ${oldCurrency} ${oldAmt} \u2192 ${newCurrency} ${newAmt}`);
				break;
			}
			case "description":
				parts.push(`title: '${String(oldVal)}' \u2192 '${String(newVal)}'`);
				break;
			case "currency":
				parts.push(`currency: ${String(oldVal)} \u2192 ${String(newVal)}`);
				break;
			case "date": {
				const fmtDate = (v: unknown) => {
					try {
						return new Date(String(v)).toLocaleDateString("en-US", {
							month: "short",
							day: "numeric",
						});
					} catch {
						return String(v);
					}
				};
				parts.push(`date: ${fmtDate(oldVal)} \u2192 ${fmtDate(newVal)}`);
				break;
			}
			case "splitMode":
				parts.push(`split: ${String(oldVal)} \u2192 ${String(newVal)}`);
				break;
			case "categoryId":
				parts.push("category changed");
				break;
			case "paidBy":
				parts.push("payer changed");
				break;
			case "splitParticipants":
				parts.push("split participants changed");
				break;
			case "notes":
				parts.push("notes updated");
				break;
			default:
				parts.push(`${key} changed`);
				break;
		}
	}

	const remaining = keys.length - parts.length;
	if (remaining > 0) {
		parts.push(`+${remaining} more`);
	}

	return parts.join(", ");
}

function serializeDecimal(val: unknown): number {
	if (val && typeof val === "object" && "toNumber" in val) {
		return (val as { toNumber(): number }).toNumber();
	}
	return Number(val);
}

function serializeTransaction(tx: Record<string, unknown>) {
	return {
		...tx,
		amount: serializeDecimal(tx.amount),
		splitParticipants: Array.isArray(tx.splitParticipants)
			? tx.splitParticipants.map((sp: Record<string, unknown>) => ({
					...sp,
					shareAmount: serializeDecimal(sp.shareAmount),
					sharePercentage: sp.sharePercentage
						? serializeDecimal(sp.sharePercentage)
						: null,
				}))
			: undefined,
	};
}

export class SharedTransactionService {
	constructor(
		private db: AppDb,
		private actor: ParticipantRef,
	) {}

	async create(input: CreateSharedTransactionInput) {
		const { amount, splitWith, splitMode, paidBy } = input;

		// Validate no duplicate participants in the split
		const seen = new Set<string>();
		for (const p of splitWith) {
			const key = `${p.participantType}:${p.participantId}`;
			if (seen.has(key)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Duplicate participant in split",
				});
			}
			seen.add(key);
		}

		// Validate payer is in the split
		const payerInSplit = splitWith.some((p) => sameParticipant(p, paidBy));
		if (!payerInSplit) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "The payer must be included in the split participants",
			});
		}

		const participants = this.computeSplits(
			amount,
			splitWith,
			splitMode,
			paidBy,
		);

		const actor = this.actor;

		const result = await this.runInTransaction(async (tx) => {
			let billingPeriodId: string | null = null;
			let backdatedWarning: { periodLabel: string } | null = null;

			if (input.projectId) {
				// Validate caller is at least CONTRIBUTOR on this project
				await requireProjectRole(
					tx,
					input.projectId,
					this.actor.participantType,
					this.actor.participantId,
					"CONTRIBUTOR",
				);

				// Validate that non-shadow paidBy and splitWith refs are actual
				// project participants (prevents phantom balances from arbitrary user refs)
				const refsToValidate: ParticipantRef[] = [];
				if (paidBy.participantType !== "shadow") {
					refsToValidate.push(paidBy);
				}
				for (const p of splitWith) {
					if (p.participantType !== "shadow") {
						refsToValidate.push(p);
					}
				}
				if (refsToValidate.length > 0) {
					const validParticipants = await tx.projectParticipant.findMany({
						where: {
							projectId: input.projectId!,
							OR: refsToValidate.map((r) => ({
								participantType: r.participantType,
								participantId: r.participantId,
							})),
						},
						select: { participantType: true, participantId: true },
					});
					const validKeys = new Set(
						validParticipants.map(
							(vp) => `${vp.participantType}:${vp.participantId}`,
						),
					);
					for (const ref of refsToValidate) {
						const key = `${ref.participantType}:${ref.participantId}`;
						if (!validKeys.has(key)) {
							throw new TRPCError({
								code: "BAD_REQUEST",
								message: `Participant ${ref.participantId} is not a member of this project`,
							});
						}
					}
				}

				// For ONGOING projects, auto-link to the current OPEN billing period.
				// Always assigns to the OPEN period regardless of the transaction's date:
				// if the date predates the period start, surface a warning to the caller.
				const project = await tx.project.findUnique({
					where: { id: input.projectId },
					select: { type: true },
				});
				if (project?.type === "ONGOING") {
					const openPeriod = await tx.billingPeriod.findFirst({
						where: { projectId: input.projectId, status: "OPEN" },
						orderBy: { startDate: "desc" },
					});
					if (openPeriod) {
						billingPeriodId = openPeriod.id;
						if (input.date < openPeriod.startDate) {
							backdatedWarning = { periodLabel: openPeriod.label };
						}
					}
				}
			}

			const transaction = await tx.sharedTransaction.create({
				data: {
					description: input.description,
					amount: input.amount,
					currency: input.currency,
					date: input.date,
					categoryId: input.categoryId,
					splitMode: splitMode as SplitMode,
					notes: input.notes,
					receiptUrl: input.receiptUrl,
					paidByType: paidBy.participantType,
					paidById: paidBy.participantId,
					createdByType: this.actor.participantType,
					createdById: this.actor.participantId,
					projectId: input.projectId,
					billingPeriodId,
					splitParticipants: {
						create: participants.map((p) => ({
							participantType: p.participantType,
							participantId: p.participantId,
							shareAmount: p.shareAmount!,
							sharePercentage: p.sharePercentage ?? null,
							shareUnits: p.shareUnits ?? null,
							verificationStatus: sameParticipant(p, actor)
								? "ACCEPTED"
								: "PENDING",
							verifiedAt: sameParticipant(p, actor) ? new Date() : undefined,
						})),
					},
				},
				include: { splitParticipants: true },
			});

			// Auto-add shadow participants not yet in the project
			if (input.projectId) {
				for (const p of input.splitWith) {
					if (p.participantType !== "shadow") continue;
					const alreadyIn = await tx.projectParticipant.findUnique({
						where: {
							projectId_participantType_participantId: {
								projectId: input.projectId!,
								participantType: "shadow",
								participantId: p.participantId,
							},
						},
					});
					if (!alreadyIn) {
						await tx.projectParticipant.create({
							data: {
								projectId: input.projectId!,
								participantType: "shadow",
								participantId: p.participantId,
								role: "CONTRIBUTOR",
							},
						});
					}
				}
			}

			await logAudit(tx, {
				actor,
				action: "CREATED",
				targetType: "SHARED_TRANSACTION",
				targetId: transaction.id,
				changes: serializeTransaction(
					transaction as unknown as Record<string, unknown>,
				),
				projectId: input.projectId,
			});

			return { transaction, backdatedWarning };
		});

		// Notify user-type split participants (excluding the creator)
		this.notifyExpenseSplit(result.transaction).catch((err) =>
			console.error("[Notification Error] EXPENSE_SPLIT:", err),
		);

		return result;
	}

	private async notifyExpenseSplit(transaction: {
		id: string;
		description: string;
		amount: unknown;
		currency: string;
		createdByType: string;
		createdById: string;
		splitParticipants: Array<{
			participantType: string;
			participantId: string;
			shareAmount: unknown;
		}>;
	}) {
		const actorName = await resolveParticipantName(
			this.actor.participantType,
			this.actor.participantId,
		);
		const totalAmount = Number(transaction.amount);
		const currency = transaction.currency;
		const desc = transaction.description;

		for (const sp of transaction.splitParticipants) {
			if (sp.participantType !== "user") continue;
			// Don't notify the creator
			if (
				sp.participantType === this.actor.participantType &&
				sp.participantId === this.actor.participantId
			)
				continue;

			const shareAmount = Number(sp.shareAmount);
			await createNotification({
				userId: sp.participantId,
				type: "EXPENSE_SPLIT",
				title: "New shared expense",
				body: `${actorName} split '${desc}' with you; your share: ${currency} ${shareAmount.toFixed(2)} (of ${currency} ${totalAmount.toFixed(2)})`,
				data: {
					transactionId: transaction.id,
					actorType: this.actor.participantType,
					actorId: this.actor.participantId,
				},
			});
		}
	}

	async update(input: UpdateSharedTransactionInput) {
		const actor = this.actor;
		let existingSnapshot: {
			description: string;
			amount: unknown;
			currency: string;
		} | null = null;
		let capturedDiff: Record<string, { old: unknown; new: unknown }> = {};

		const updated = await this.runInTransaction(async (tx) => {
			const existing = await assertCanModifyTransaction(
				tx,
				input.id,
				this.actor.participantType,
				this.actor.participantId,
			);

			// Capture before-state for notification
				existingSnapshot = {
				description: existing.description,
				amount: existing.amount,
				currency: existing.currency,
			};

			// Compute field-level diff
			const diff: Record<string, { old: unknown; new: unknown }> = {};

			const fieldUpdates: Partial<{
			description: string;
				amount: number;
				currency: string;
				date: Date;
				categoryId: string | null;
				splitMode: SplitMode;
				notes: string | null;
				receiptUrl: string | null;
				projectId: string | null;
				paidByType: string;
				paidById: string;
			}> = {};

			if (
				input.description !== undefined &&
				input.description !== existing.description
			) {
				diff.description = {
					old: existing.description,
					new: input.description,
				};
				fieldUpdates.description = input.description;
			}
			if (
				input.amount !== undefined &&
				input.amount !== serializeDecimal(existing.amount)
			) {
				diff.amount = {
					old: serializeDecimal(existing.amount),
					new: input.amount,
				};
				fieldUpdates.amount = input.amount;
			}
			if (
				input.currency !== undefined &&
				input.currency !== existing.currency
			) {
				diff.currency = {
					old: existing.currency,
					new: input.currency,
				};
				fieldUpdates.currency = input.currency;
			}
			if (input.date !== undefined) {
				const oldDate = existing.date.toISOString();
				const newDate = input.date.toISOString();
				if (oldDate !== newDate) {
					diff.date = { old: oldDate, new: newDate };
					fieldUpdates.date = input.date;
				}
			}
			if (
				input.categoryId !== undefined &&
				input.categoryId !== existing.categoryId
			) {
				diff.categoryId = {
					old: existing.categoryId,
					new: input.categoryId,
				};
				fieldUpdates.categoryId = input.categoryId;
			}
			if (
				input.splitMode !== undefined &&
				input.splitMode !== existing.splitMode
			) {
				diff.splitMode = {
					old: existing.splitMode,
					new: input.splitMode,
				};
				fieldUpdates.splitMode = input.splitMode as SplitMode;
			}
			if (input.notes !== undefined && input.notes !== existing.notes) {
				diff.notes = { old: existing.notes, new: input.notes };
				fieldUpdates.notes = input.notes;
			}
			if (
				input.receiptUrl !== undefined &&
				input.receiptUrl !== existing.receiptUrl
			) {
				diff.receiptUrl = {
					old: existing.receiptUrl,
					new: input.receiptUrl,
				};
				fieldUpdates.receiptUrl = input.receiptUrl;
			}
			if (
				input.projectId !== undefined &&
				input.projectId !== existing.projectId
			) {
				diff.projectId = {
					old: existing.projectId,
					new: input.projectId,
				};
				fieldUpdates.projectId = input.projectId;
			}

			// Handle paidBy changes
			if (input.paidBy !== undefined) {
				if (
					input.paidBy.participantType !== existing.paidByType ||
					input.paidBy.participantId !== existing.paidById
				) {
					// If splitWith is not being changed, validate the new payer is in the existing split
					if (input.splitWith === undefined) {
						const payerInExistingSplit = existing.splitParticipants.some(
							(sp) =>
								sp.participantType === input.paidBy!.participantType &&
								sp.participantId === input.paidBy!.participantId,
						);
						if (!payerInExistingSplit) {
							throw new TRPCError({
								code: "BAD_REQUEST",
								message: "The payer must be included in the split participants",
							});
						}
					}

					diff.paidBy = {
						old: {
							participantType: existing.paidByType,
							participantId: existing.paidById,
						},
						new: input.paidBy,
					};
					fieldUpdates.paidByType = input.paidBy.participantType;
					fieldUpdates.paidById = input.paidBy.participantId;
				}
			}

			const effectivePaidBy = input.paidBy ?? {
				participantType: existing.paidByType as "user" | "guest" | "shadow",
				participantId: existing.paidById,
			};
			const effectiveSplitMode = (input.splitMode ??
				existing.splitMode) as SplitModeType;

			// Handle split participant changes
			let newParticipants: SplitParticipantInput[] | undefined;

			if (input.splitWith !== undefined) {
				const effectiveAmount =
					input.amount ?? serializeDecimal(existing.amount);

				// Validate no duplicate participants
				const seen = new Set<string>();
				for (const p of input.splitWith) {
					const key = `${p.participantType}:${p.participantId}`;
					if (seen.has(key)) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: "Duplicate participant in split",
						});
					}
					seen.add(key);
				}

				// Validate payer is in split
				const payerInSplit = input.splitWith.some((p) =>
					sameParticipant(p, effectivePaidBy),
				);
				if (!payerInSplit) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "The payer must be included in the split participants",
					});
				}

				newParticipants = this.computeSplits(
					effectiveAmount,
					input.splitWith,
					effectiveSplitMode,
					effectivePaidBy,
				);
			} else if (fieldUpdates.amount !== undefined) {
				// Amount changed without explicit splitWith; auto-recalculate
				// where the split mode supports it
				const effectiveAmount = input.amount!;

				if (effectiveSplitMode === "EQUAL") {
					const existingSplit = existing.splitParticipants.map((sp) => ({
						participantType: sp.participantType as "user" | "guest" | "shadow",
						participantId: sp.participantId,
					}));
					newParticipants = this.computeSplits(
						effectiveAmount,
						existingSplit,
						"EQUAL",
						effectivePaidBy,
					);
				} else if (effectiveSplitMode === "PERCENTAGE") {
					const existingSplit = existing.splitParticipants.map((sp) => ({
						participantType: sp.participantType as "user" | "guest" | "shadow",
						participantId: sp.participantId,
						sharePercentage: sp.sharePercentage
							? serializeDecimal(sp.sharePercentage)
							: undefined,
					}));
					newParticipants = this.computeSplits(
						effectiveAmount,
						existingSplit,
						"PERCENTAGE",
						effectivePaidBy,
					);
				} else if (effectiveSplitMode === "SHARES") {
					const existingSplit = existing.splitParticipants.map((sp) => ({
						participantType: sp.participantType as "user" | "guest" | "shadow",
						participantId: sp.participantId,
						shareUnits: sp.shareUnits ?? undefined,
					}));
					newParticipants = this.computeSplits(
						effectiveAmount,
						existingSplit,
						"SHARES",
						effectivePaidBy,
					);
				}
				// EXACT: don't auto-recalculate
			}

			// Compute split diff
			if (newParticipants !== undefined) {
				const oldSplits = existing.splitParticipants.map((sp) => ({
					participantType: sp.participantType,
					participantId: sp.participantId,
					shareAmount: serializeDecimal(sp.shareAmount),
				}));
				const newSplits = newParticipants.map((p) => ({
					participantType: p.participantType,
					participantId: p.participantId,
					shareAmount: p.shareAmount!,
				}));

				const splitsChanged =
					oldSplits.length !== newSplits.length ||
					oldSplits.some((old) => {
						const match = newSplits.find((n) => sameParticipant(n, old));
						return !match || match.shareAmount !== old.shareAmount;
					}) ||
					newSplits.some(
						(n) => !oldSplits.find((old) => sameParticipant(old, n)),
					);

				if (splitsChanged) {
					diff.splitParticipants = {
						old: oldSplits,
						new: newSplits,
					};
				}
			}

			// If nothing changed, return early
			if (Object.keys(diff).length === 0) {
				return existing;
			}

			// Update the transaction
			const updated = await tx.sharedTransaction.update({
				where: { id: input.id },
				data: fieldUpdates as Prisma.SharedTransactionUncheckedUpdateInput,
			});

			// Replace split participants if they changed
			if (newParticipants !== undefined && diff.splitParticipants) {
				await tx.splitParticipant.deleteMany({
					where: { transactionId: input.id },
				});

				await tx.splitParticipant.createMany({
					data: newParticipants.map((p) => ({
						transactionId: input.id,
						participantType: p.participantType,
						participantId: p.participantId,
						shareAmount: p.shareAmount!,
						sharePercentage: p.sharePercentage ?? null,
						shareUnits: p.shareUnits ?? null,
						verificationStatus: sameParticipant(p, actor)
							? ("ACCEPTED" as const)
							: ("PENDING" as const),
						verifiedAt: sameParticipant(p, actor) ? new Date() : undefined,
					})),
				});
			} else {
				// Even if splits didn't change structurally, reset verification
				// because the transaction details changed
				await tx.splitParticipant.updateMany({
					where: {
						transactionId: input.id,
						NOT: {
							participantType: actor.participantType,
							participantId: actor.participantId,
						},
					},
					data: {
						verificationStatus: "PENDING",
						verifiedAt: null,
						rejectionReason: null,
					},
				});
			}

			// Mark all participants except the editor as having unseen changes
			await tx.splitParticipant.updateMany({
				where: {
					transactionId: input.id,
					NOT: {
						participantType: actor.participantType,
						participantId: actor.participantId,
					},
				},
				data: { hasUnseenChanges: true },
			});

			await logAudit(tx, {
				actor,
				action: "EDITED",
				targetType: "SHARED_TRANSACTION",
				targetId: input.id,
				changes: diff as Prisma.InputJsonValue,
				projectId:
					input.projectId !== undefined
						? (input.projectId ?? undefined)
						: (existing.projectId ?? undefined),
			});

			// Capture diff for notification
			capturedDiff = diff;

			// Refetch with participants
			return await tx.sharedTransaction.findUniqueOrThrow({
				where: { id: input.id },
				include: { splitParticipants: true },
			});
		});

		// Notify user-type participants (excluding the actor) that the expense changed
		if (existingSnapshot) {
			this.notifyExpenseEdited(updated, existingSnapshot, capturedDiff).catch((err) =>
				console.error("[Notification Error] EXPENSE_EDITED:", err),
			);
		}

		return updated;
	}

	private async notifyExpenseEdited(
		updated: {
			id: string;
			description: string;
			amount: unknown;
			currency: string;
			splitParticipants: Array<{
				participantType: string;
				participantId: string;
			}>;
		},
		existing: { description: string; amount: unknown; currency: string },
		diff: Record<string, { old: unknown; new: unknown }>,
	) {
		const actorName = await resolveParticipantName(
			this.actor.participantType,
			this.actor.participantId,
		);
		const desc = updated.description;

		// Build human-readable changes from the diff
		const changes = buildChangeSummary(diff, existing.currency, updated.currency);
		const body = changes
			? `${actorName} updated '${desc}': ${changes}. Please re-verify.`
			: `${actorName} updated '${desc}'. Please re-verify.`;

		for (const sp of updated.splitParticipants) {
			if (sp.participantType !== "user") continue;
			if (
				sp.participantType === this.actor.participantType &&
				sp.participantId === this.actor.participantId
			)
				continue;

			await createNotification({
				userId: sp.participantId,
				type: "EXPENSE_EDITED",
				title: "Expense updated",
				body,
				data: {
					transactionId: updated.id,
					actorType: this.actor.participantType,
					actorId: this.actor.participantId,
					changes: changes || undefined,
				},
			});
		}
	}

	async delete(id: string) {
		const actor = this.actor;
		let deletedSnapshot: {
			id: string;
			description: string;
			amount: unknown;
			currency: string;
			splitParticipants: Array<{
				participantType: string;
				participantId: string;
			}>;
		} | null = null;

		await this.runInTransaction(async (tx) => {
			const existing = await assertCanModifyTransaction(
				tx,
				id,
				this.actor.participantType,
				this.actor.participantId,
			);

			// Capture snapshot for notification before deleting
				deletedSnapshot = {
					id: existing.id,
					description: existing.description,
				amount: existing.amount,
				currency: existing.currency,
				splitParticipants: existing.splitParticipants.map((sp) => ({
					participantType: sp.participantType,
					participantId: sp.participantId,
				})),
			};

			// Snapshot into audit log before deleting
			await logAudit(tx, {
				actor,
				action: "DELETED",
				targetType: "SHARED_TRANSACTION",
				targetId: id,
				changes: serializeTransaction(
					existing as unknown as Record<string, unknown>,
				),
				projectId: existing.projectId ?? undefined,
			});

			await tx.sharedTransaction.delete({ where: { id } });
		});

		// Notify user-type participants (excluding actor) that the expense was deleted
		if (deletedSnapshot) {
			this.notifyExpenseDeleted(deletedSnapshot).catch((err) =>
				console.error("[Notification Error] EXPENSE_DELETED:", err),
			);
		}
	}

	private async notifyExpenseDeleted(existing: {
		id: string;
		description: string;
		amount: unknown;
		currency: string;
		splitParticipants: Array<{
			participantType: string;
			participantId: string;
		}>;
	}) {
		const actorName = await resolveParticipantName(
			this.actor.participantType,
			this.actor.participantId,
		);
		const amount = Number(existing.amount);
		const desc = existing.description;
		const currency = existing.currency;

		for (const sp of existing.splitParticipants) {
			if (sp.participantType !== "user") continue;
			if (
				sp.participantType === this.actor.participantType &&
				sp.participantId === this.actor.participantId
			)
				continue;

			await createNotification({
				userId: sp.participantId,
				type: "EXPENSE_DELETED",
				title: "Expense deleted",
				body: `${actorName} deleted '${desc}' (${currency} ${amount.toFixed(2)})`,
				data: {
					transactionId: existing.id,
					actorType: this.actor.participantType,
					actorId: this.actor.participantId,
				},
			});
		}
	}

	private computeSplits(
		amount: number,
		splitWith: SplitParticipantInput[],
		splitMode: SplitModeType,
		paidBy: ParticipantRef,
	): SplitParticipantInput[] {
		if (splitMode === "EQUAL") {
			return this.computeEqualSplits(amount, splitWith, paidBy);
		}
		if (splitMode === "EXACT") {
			return this.computeExactSplits(amount, splitWith);
		}
		if (splitMode === "PERCENTAGE") {
			return this.computePercentageSplits(amount, splitWith, paidBy);
		}
		return this.computeSharesSplits(amount, splitWith, paidBy);
	}

	private computeEqualSplits(
		amount: number,
		splitWith: SplitParticipantInput[],
		paidBy: ParticipantRef,
	): SplitParticipantInput[] {
		const count = splitWith.length;
		// Use integer cents to avoid floating point issues
		const totalCents = Math.round(amount * 100);
		const baseCents = Math.floor(totalCents / count);
		let remainder = totalCents - baseCents * count;

		// Build result with base amounts
		const result = splitWith.map((p) => ({
			participantType: p.participantType,
			participantId: p.participantId,
			cents: baseCents,
		}));

		// Assign extra cents: payer first, then others in order
		if (remainder > 0) {
			const payerIdx = result.findIndex((r) => sameParticipant(r, paidBy));
			if (payerIdx >= 0) {
				result[payerIdx]!.cents += 1;
				remainder -= 1;
			}
			for (let i = 0; i < result.length && remainder > 0; i++) {
				if (i !== payerIdx) {
					result[i]!.cents += 1;
					remainder -= 1;
				}
			}
		}

		return result.map((r) => ({
			participantType: r.participantType,
			participantId: r.participantId,
			shareAmount: r.cents / 100,
		}));
	}

	private computeExactSplits(
		amount: number,
		splitWith: SplitParticipantInput[],
	): SplitParticipantInput[] {
		const totalCents = Math.round(amount * 100);
		const sumCents = splitWith.reduce(
			(sum, p) => sum + Math.round((p.shareAmount ?? 0) * 100),
			0,
		);

		if (sumCents !== totalCents) {
			const difference = Math.abs(amount - sumCents / 100);
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Split amounts must sum to the transaction amount. Expected ${amount}, got ${sumCents / 100} (difference: ${difference.toFixed(2)})`,
			});
		}

		return splitWith.map((p) => ({
			participantType: p.participantType,
			participantId: p.participantId,
			shareAmount: p.shareAmount!,
		}));
	}

	private computePercentageSplits(
		amount: number,
		splitWith: SplitParticipantInput[],
		paidBy: ParticipantRef,
	): SplitParticipantInput[] {
		// Validate all participants have sharePercentage
		for (const p of splitWith) {
			if (p.sharePercentage === undefined || p.sharePercentage === null) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Participant ${p.participantId} is missing sharePercentage for PERCENTAGE split mode`,
				});
			}
		}

		const rawSum = splitWith.reduce((s, p) => s + p.sharePercentage!, 0);
		if (rawSum < 99.99 || rawSum > 100.01) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Percentages must sum to 100. Got ${rawSum.toFixed(4)}`,
			});
		}

		// Adjust last participant so percentages sum to exactly 100
		const participants = splitWith.map((p) => ({ ...p }));
		const othersSum = participants
			.slice(0, -1)
			.reduce((s, p) => s + p.sharePercentage!, 0);
		participants[participants.length - 1]!.sharePercentage = 100 - othersSum;

		// Compute amounts using integer cents, floor each
		const totalCents = Math.round(amount * 100);
		const result = participants.map((p) => ({
			participantType: p.participantType,
			participantId: p.participantId,
			sharePercentage: p.sharePercentage!,
			cents: Math.floor((totalCents * p.sharePercentage!) / 100),
		}));

		const sumCents = result.reduce((s, r) => s + r.cents, 0);
		const remainder = totalCents - sumCents;

		if (Math.abs(remainder) > result.length) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Unexpected large rounding error in percentage split",
			});
		}

		// Assign remainder cents to payer first
		if (remainder !== 0) {
			const payerIdx = result.findIndex((r) => sameParticipant(r, paidBy));
			const idx = payerIdx >= 0 ? payerIdx : result.length - 1;
			result[idx]!.cents += remainder;
		}

		return result.map((r) => ({
			participantType: r.participantType,
			participantId: r.participantId,
			shareAmount: r.cents / 100,
			sharePercentage: r.sharePercentage,
		}));
	}

	private computeSharesSplits(
		amount: number,
		splitWith: SplitParticipantInput[],
		paidBy: ParticipantRef,
	): SplitParticipantInput[] {
		// Validate all participants have positive integer shareUnits
		for (const p of splitWith) {
			if (!p.shareUnits || p.shareUnits < 1) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Participant ${p.participantId} must have shareUnits >= 1 for SHARES split mode`,
				});
			}
		}

		const totalUnits = splitWith.reduce((s, p) => s + p.shareUnits!, 0);
		const totalCents = Math.round(amount * 100);

		const result = splitWith.map((p) => ({
			participantType: p.participantType,
			participantId: p.participantId,
			shareUnits: p.shareUnits!,
			cents: Math.floor((totalCents * p.shareUnits!) / totalUnits),
		}));

		const sumCents = result.reduce((s, r) => s + r.cents, 0);
		const remainder = totalCents - sumCents;

		if (Math.abs(remainder) > result.length) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Unexpected large rounding error in shares split",
			});
		}

		// Assign remainder cents to payer first
		if (remainder !== 0) {
			const payerIdx = result.findIndex((r) => sameParticipant(r, paidBy));
			const idx = payerIdx >= 0 ? payerIdx : result.length - 1;
			result[idx]!.cents += remainder;
		}

		return result.map((r) => ({
			participantType: r.participantType,
			participantId: r.participantId,
			shareAmount: r.cents / 100,
			shareUnits: r.shareUnits,
		}));
	}

	private async runInTransaction<T>(
		callback: (tx: Prisma.TransactionClient) => Promise<T>,
	): Promise<T> {
		return await this.db.$transaction(async (tx) => {
			await tx.$executeRaw`SELECT set_config('app.current_user_id', ${this.actor.participantId}, true),
			                            set_config('role', 'retrospend_app', true)`;
			return await callback(tx);
		});
	}
}
