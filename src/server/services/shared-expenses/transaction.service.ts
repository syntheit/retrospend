import { TRPCError } from "@trpc/server";
import {
	createNotification,
	resolveParticipantName,
} from "~/server/services/notifications";
import type { Prisma, PrismaClient, SplitMode } from "~prisma";
import { logAudit } from "./audit-log";
import {
	effectOfRemovingShare,
	type ShareRemovalEffect,
} from "./balance-change";
import {
	assertCanModifyTransaction,
	requireProjectRole,
} from "./project-permissions";
import { type ParticipantRef, sameParticipant } from "./types";
import { resolveVerification } from "./auto-accept";
import {
	resolveSplits,
	SplitComputationError,
} from "~/lib/shared-split-computation";

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

		// The payer is intentionally NOT required to be one of the split
		// participants. A payer outside the split simply gets no split row: they
		// owe nothing and are owed the full amount ("I fronted a cost I'm not
		// part of"). computeBalance already treats this correctly.

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
				await this.validateProjectMembership(
					tx,
					input.projectId,
					paidBy,
					splitWith,
				);

				// Shadows outside the project are auto-added below; only allow ones
				// the caller already has a relationship with.
				await this.assertShadowsAddable(tx, input.projectId, [
					paidBy,
					...splitWith,
				]);

				// Auto-link to the current OPEN billing period (if any).
				// Always assigns to the OPEN period regardless of the transaction's date:
				// if the date predates the period start, surface a warning to the caller.
				const openPeriod = await this.findOpenPeriod(tx, input.projectId);
				if (openPeriod) {
					billingPeriodId = openPeriod.id;
					if (input.date < openPeriod.startDate) {
						backdatedWarning = { periodLabel: openPeriod.label };
					}
				}
			}

			// Auto-accept is decided by the expense's PROJECT: when the project
			// auto-accepts (or it's a standalone expense) non-actor user splits
			// skip the manual approval gate.
			const projectAutoAccept = await this.resolveProjectAutoAccept(
				tx,
				input.projectId,
			);

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
						create: participants.map((p) => {
							const { status, verifiedAt } = this.resolveVerification(
								p,
								actor,
								projectAutoAccept,
							);
							return {
								participantType: p.participantType,
								participantId: p.participantId,
								shareAmount: p.shareAmount!,
								sharePercentage: p.sharePercentage ?? null,
								shareUnits: p.shareUnits ?? null,
								verificationStatus: status,
								verifiedAt,
							};
						}),
					},
				},
				include: { splitParticipants: true },
			});

			// Auto-add shadow participants (split members and a shadow payer) not
			// yet in the project
			if (input.projectId) {
				await this.autoAddShadowParticipants(tx, input.projectId, [
					paidBy,
					...input.splitWith,
				]);
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
				billingPeriodId: string | null;
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
			const projectChanged =
				input.projectId !== undefined &&
				input.projectId !== existing.projectId;
			if (projectChanged) {
				diff.projectId = {
					old: existing.projectId,
					new: input.projectId,
				};
				fieldUpdates.projectId = input.projectId;

				if (input.projectId) {
					// Moving into a project takes the same role as creating there.
					await requireProjectRole(
						tx,
						input.projectId,
						this.actor.participantType,
						this.actor.participantId,
						"CONTRIBUTOR",
					);
				}

				// The old project's billing period means nothing in the new one.
				// Mirror create: join the target's current OPEN period, if any.
				const openPeriod = input.projectId
					? await this.findOpenPeriod(tx, input.projectId)
					: null;
				fieldUpdates.billingPeriodId = openPeriod?.id ?? null;
			}

			// Handle paidBy changes
			let paidByChanged = false;
			if (input.paidBy !== undefined) {
				if (
					input.paidBy.participantType !== existing.paidByType ||
					input.paidBy.participantId !== existing.paidById
				) {
					paidByChanged = true;
					// The new payer is intentionally allowed to be outside the split:
					// they front the cost without owing a share. They must still be a
					// member of the project (checked below with the split).

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

			// The project the expense belongs to after this update. Membership and
			// shadow auto-add are enforced against it, mirroring create.
			const effectiveProjectId =
				input.projectId !== undefined ? input.projectId : existing.projectId;

			// The split and payer the expense will have after this update.
			const effectiveSplitRefs: SplitParticipantInput[] =
				input.splitWith ??
				existing.splitParticipants.map((sp) => ({
					participantType: sp.participantType as "user" | "guest" | "shadow",
					participantId: sp.participantId,
				}));

			// Whoever ends up on the expense must belong to its project, like on
			// create. Moving projects re-checks everyone; an explicit new split is
			// checked with the payer; a payer-only change checks just the payer, so
			// old expenses with since-removed members stay editable.
			if (
				effectiveProjectId &&
				(projectChanged || input.splitWith !== undefined || paidByChanged)
			) {
				const refsToCheck =
					projectChanged || input.splitWith !== undefined
						? effectiveSplitRefs
						: [];
				await this.validateProjectMembership(
					tx,
					effectiveProjectId,
					effectivePaidBy,
					refsToCheck,
				);
				await this.assertShadowsAddable(tx, effectiveProjectId, [
					effectivePaidBy,
					...refsToCheck,
				]);
			}

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

				// The payer is intentionally allowed to be outside the split: they
				// front the cost without owing a share, so they simply get no split
				// row. Project membership of the new split was checked above.

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
				} else if (effectiveSplitMode === "EXACT") {
					// EXACT with the amount changed but splitWith unchanged: the stored
					// exact shares would otherwise go stale (their sum no longer equals
					// the amount, silently corrupting balances). Rescale each share
					// proportionally to the new amount, keeping it cent-accurate.
					newParticipants = this.rescaleExactSplits(
						serializeDecimal(existing.amount),
						effectiveAmount,
						existing.splitParticipants.map((sp) => ({
							participantType: sp.participantType as
								| "user"
								| "guest"
								| "shadow",
							participantId: sp.participantId,
							shareAmount: serializeDecimal(sp.shareAmount),
						})),
						effectivePaidBy,
					);
				}
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

			// Auto-accept is decided by the expense's PROJECT (effectiveProjectId
			// computed above): the incoming project when the update moves the
			// expense, otherwise the existing one.
			const projectAutoAccept = await this.resolveProjectAutoAccept(
				tx,
				effectiveProjectId,
			);

			// Replace split participants if they changed
			if (newParticipants !== undefined && diff.splitParticipants) {
				await tx.splitParticipant.deleteMany({
					where: { transactionId: input.id },
				});

				await tx.splitParticipant.createMany({
					data: newParticipants.map((p) => {
						const { status, verifiedAt } = this.resolveVerification(
							p,
							actor,
							projectAutoAccept,
						);
						return {
							transactionId: input.id,
							participantType: p.participantType,
							participantId: p.participantId,
							shareAmount: p.shareAmount!,
							sharePercentage: p.sharePercentage ?? null,
							shareUnits: p.shareUnits ?? null,
							verificationStatus: status,
							verifiedAt,
						};
					}),
				});
			} else {
				// Even if splits didn't change structurally, reset verification
				// because the transaction details changed. When the project
				// auto-accepts, every non-actor participant re-accepts immediately;
				// shadows always re-accept (a ghost can never approve); everyone else
				// resets to PENDING for manual re-approval.
				const nonActorParticipants = await tx.splitParticipant.findMany({
					where: {
						transactionId: input.id,
						NOT: {
							participantType: actor.participantType,
							participantId: actor.participantId,
						},
					},
					select: { id: true, participantType: true },
				});

				const autoAcceptIds: string[] = [];
				const resetIds: string[] = [];
				for (const p of nonActorParticipants) {
					if (projectAutoAccept || p.participantType === "shadow") {
						autoAcceptIds.push(p.id);
					} else {
						resetIds.push(p.id);
					}
				}

				if (autoAcceptIds.length > 0) {
					await tx.splitParticipant.updateMany({
						where: { id: { in: autoAcceptIds } },
						data: {
							verificationStatus: "AUTO_ACCEPTED",
							verifiedAt: new Date(),
							rejectionReason: null,
						},
					});
				}

				if (resetIds.length > 0) {
					await tx.splitParticipant.updateMany({
						where: { id: { in: resetIds } },
						data: {
							verificationStatus: "PENDING",
							verifiedAt: null,
							rejectionReason: null,
						},
					});
				}
			}

			// Auto-add any shadow participant introduced by this edit (or brought
			// along by a project move) to the project roster, mirroring create.
			// Without this a shadow can be in the split but missing from the
			// project's participant list (balances/settlement).
			if (
				effectiveProjectId &&
				(projectChanged || input.splitWith !== undefined || paidByChanged)
			) {
				await this.autoAddShadowParticipants(tx, effectiveProjectId, [
					effectivePaidBy,
					...(projectChanged || input.splitWith !== undefined
						? effectiveSplitRefs
						: []),
				]);
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

	async delete(id: string, confirmUnsettled = false) {
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

			// Guard against silently changing who owes whom. Deleting an expense
			// cascades its split rows away, so any balance it created disappears
			// from computeBalance (only the audit log retains a trace). Require an
			// explicit acknowledgement when that erases an unpaid debt, or when
			// payments already recorded for it would turn into a debt the other
			// way round.
			if (!confirmUnsettled) {
				const effect = await this.deletionEffect(
					tx as unknown as PrismaClient,
					existing,
				);
				if (effect === "flips_balance") {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message:
							"Payments or other expenses already cover this expense, so deleting it would leave the payer owing money. Confirm to delete anyway.",
					});
				}
				if (effect === "erases_debt") {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message:
							"This expense still has an unsettled balance between participants. Deleting it removes that debt. Confirm to delete anyway.",
					});
				}
			}

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

	/**
	 * The strongest effect deleting this expense has on the balance between
	 * its payer and any participant they covered (see
	 * {@link effectOfRemovingShare}): "flips_balance" when a recorded payment
	 * would become a debt the other way round, else "erases_debt" when someone
	 * still owes the payer, else "none".
	 */
	private async deletionEffect(
		db: PrismaClient,
		existing: {
			projectId: string | null;
			currency: string;
			paidByType: string;
			paidById: string;
			splitParticipants: Array<{
				participantType: string;
				participantId: string;
				shareAmount: Prisma.Decimal | number;
			}>;
		},
	): Promise<ShareRemovalEffect> {
		const payer: ParticipantRef = {
			participantType: existing.paidByType as "user" | "guest" | "shadow",
			participantId: existing.paidById,
		};
		const TOLERANCE = 0.005;
		let strongest: ShareRemovalEffect = "none";

		for (const sp of existing.splitParticipants) {
			// The payer's own share is not a debt.
			if (
				sp.participantType === payer.participantType &&
				sp.participantId === payer.participantId
			) {
				continue;
			}
			// This participant contributes debt only if they were charged a share.
			const share = Number(sp.shareAmount);
			if (share <= TOLERANCE) continue;

			const effect = await effectOfRemovingShare(db, {
				payer,
				participant: {
					participantType: sp.participantType as "user" | "guest" | "shadow",
					participantId: sp.participantId,
				},
				share,
				currency: existing.currency,
				projectId: existing.projectId,
			});
			if (effect === "flips_balance") return effect;
			if (effect === "erases_debt") strongest = effect;
		}

		return strongest;
	}

	/**
	 * Resolves the auto-accept behavior for an expense from its PROJECT flag.
	 * Standalone expenses (no project) have no approval gate, so they always
	 * auto-accept. A missing project row also falls back to auto-accept.
	 */
	private async resolveProjectAutoAccept(
		tx: Prisma.TransactionClient,
		projectId: string | null | undefined,
	): Promise<boolean> {
		if (!projectId) return true;
		const project = await tx.project.findUnique({
			where: { id: projectId },
			select: { autoAcceptSplits: true },
		});
		return project?.autoAcceptSplits ?? true;
	}

	/**
	 * Delegates to the shared {@link resolveVerification} helper. Kept as a thin
	 * instance method so the create/update call sites read unchanged.
	 */
	private resolveVerification(
		p: ParticipantRef,
		actor: ParticipantRef,
		projectAutoAccept: boolean,
	): {
		status: "ACCEPTED" | "AUTO_ACCEPTED" | "PENDING";
		verifiedAt: Date | undefined;
	} {
		return resolveVerification(p, actor, projectAutoAccept);
	}

	/**
	 * Validates that the non-shadow paidBy and splitWith refs are actual members
	 * of the project (prevents phantom balances from arbitrary refs). Shadows are
	 * exempt: CREATE/UPDATE auto-add them. Used by both create and update so the
	 * two paths enforce membership identically.
	 */
	private async validateProjectMembership(
		tx: Prisma.TransactionClient,
		projectId: string,
		paidBy: ParticipantRef,
		splitWith: SplitParticipantInput[],
	): Promise<void> {
		const refsToValidate: ParticipantRef[] = [];
		if (paidBy.participantType !== "shadow") {
			refsToValidate.push(paidBy);
		}
		for (const p of splitWith) {
			if (p.participantType !== "shadow") {
				refsToValidate.push(p);
			}
		}
		if (refsToValidate.length === 0) return;

		const validParticipants = await tx.projectParticipant.findMany({
			where: {
				projectId,
				OR: refsToValidate.map((r) => ({
					participantType: r.participantType,
					participantId: r.participantId,
				})),
			},
			select: { participantType: true, participantId: true },
		});
		const validKeys = new Set(
			validParticipants.map((vp) => `${vp.participantType}:${vp.participantId}`),
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

	/** The project's current OPEN billing period, if any (same pick as create). */
	private async findOpenPeriod(
		tx: Prisma.TransactionClient,
		projectId: string,
	) {
		return tx.billingPeriod.findFirst({
			where: { projectId, status: "OPEN" },
			orderBy: { startDate: "desc" },
		});
	}

	/**
	 * Shadows that aren't in the project yet get auto-added to it, which also
	 * puts them on the path to being claimed through this project. So the actor
	 * may only bring in a shadow they created, or one already in another project
	 * where they are EDITOR or ORGANIZER. Using a shadow that is already in this
	 * project is fine for anyone who may write here. Guests can only use shadows
	 * already in their project. Without this anyone could pull an arbitrary
	 * shadow id into their own project.
	 */
	private async assertShadowsAddable(
		tx: Prisma.TransactionClient,
		projectId: string,
		refs: ParticipantRef[],
	): Promise<void> {
		const shadowIds = [
			...new Set(
				refs
					.filter((r) => r.participantType === "shadow")
					.map((r) => r.participantId),
			),
		];
		for (const shadowId of shadowIds) {
			const alreadyIn = await tx.projectParticipant.findUnique({
				where: {
					projectId_participantType_participantId: {
						projectId,
						participantType: "shadow",
						participantId: shadowId,
					},
				},
				select: { id: true },
			});
			if (alreadyIn) continue;

			if (
				this.actor.participantType === "user" &&
				(await this.actorCanUseShadow(tx, shadowId))
			) {
				continue;
			}

			throw new TRPCError({
				code: "FORBIDDEN",
				message: "You can only add people you know to this project",
			});
		}
	}

	/** See {@link assertShadowsAddable}. Only meaningful for user actors. */
	private async actorCanUseShadow(
		tx: Prisma.TransactionClient,
		shadowId: string,
	): Promise<boolean> {
		const shadow = await tx.shadowProfile.findUnique({
			where: { id: shadowId },
			select: { createdById: true },
		});
		if (shadow?.createdById === this.actor.participantId) return true;

		const shadowProjects = await tx.projectParticipant.findMany({
			where: { participantType: "shadow", participantId: shadowId },
			select: { projectId: true },
		});
		if (shadowProjects.length === 0) return false;

		const shared = await tx.projectParticipant.findMany({
			where: {
				projectId: { in: shadowProjects.map((p) => p.projectId) },
				participantType: "user",
				participantId: this.actor.participantId,
			},
			select: { role: true },
		});
		// Pulling a ghost into another project widens what claiming it grants,
		// and canMintClaimLink then needs EDITOR+ there too. So only someone who
		// already manages one of the ghost's projects may do it: a CONTRIBUTOR
		// must not be able to spread a ghost (and lock its organizer out of
		// claim links) just by splitting an expense with it.
		return shared.some((m) => m.role === "EDITOR" || m.role === "ORGANIZER");
	}

	/**
	 * Auto-adds any shadow participants not yet in the project as CONTRIBUTORs, so
	 * a shadow added via create or edit shows up in the project roster (balances,
	 * settlement). Callers must run {@link assertShadowsAddable} first.
	 */
	private async autoAddShadowParticipants(
		tx: Prisma.TransactionClient,
		projectId: string,
		refs: ParticipantRef[],
	): Promise<void> {
		const seen = new Set<string>();
		for (const p of refs) {
			if (p.participantType !== "shadow") continue;
			if (seen.has(p.participantId)) continue;
			seen.add(p.participantId);
			const alreadyIn = await tx.projectParticipant.findUnique({
				where: {
					projectId_participantType_participantId: {
						projectId,
						participantType: "shadow",
						participantId: p.participantId,
					},
				},
			});
			if (!alreadyIn) {
				await tx.projectParticipant.create({
					data: {
						projectId,
						participantType: "shadow",
						participantId: p.participantId,
						role: "CONTRIBUTOR",
					},
				});
			}
		}
	}

	/**
	 * Resolves the concrete per-participant split rows. Delegates to the shared
	 * pure {@link resolveSplits} utility (the same code the client preview uses,
	 * so the preview matches what is saved) and translates its validation errors
	 * into TRPCErrors for the API layer.
	 */
	private computeSplits(
		amount: number,
		splitWith: SplitParticipantInput[],
		splitMode: SplitModeType,
		paidBy: ParticipantRef,
	): SplitParticipantInput[] {
		// A missing EXACT amount counts as 0 in the sum check, so it can pass
		// validation and then fail the insert (shareAmount is required). Reject
		// it here as a validation error instead.
		if (splitMode === "EXACT") {
			const missing = splitWith.find(
				(p) => p.shareAmount === undefined || p.shareAmount === null,
			);
			if (missing) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Participant ${missing.participantId} is missing shareAmount for EXACT split mode`,
				});
			}
		}
		try {
			return resolveSplits({
				mode: splitMode,
				amount,
				participants: splitWith,
				paidBy,
			});
		} catch (err) {
			if (err instanceof SplitComputationError) {
				throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
			}
			throw err;
		}
	}

	/**
	 * Proportionally rescales stored EXACT shares to a new total. Each share keeps
	 * its fraction of the old total; the leftover cent from flooring goes to the
	 * payer first (else the last row), matching the rounding rule used elsewhere.
	 * If the old total was 0 (no proportion to preserve), falls back to an equal
	 * split so the shares still sum to the new amount.
	 */
	private rescaleExactSplits(
		oldAmount: number,
		newAmount: number,
		splits: Array<SplitParticipantInput & { shareAmount: number }>,
		paidBy: ParticipantRef,
	): SplitParticipantInput[] {
		const newTotalCents = Math.round(newAmount * 100);

		if (Math.round(oldAmount * 100) === 0) {
			// Degenerate case: nothing to scale from. Split equally.
			return this.computeSplits(newAmount, splits, "EQUAL", paidBy);
		}

		const oldTotalCents = splits.reduce(
			(s, p) => s + Math.round(p.shareAmount * 100),
			0,
		);
		if (oldTotalCents === 0) {
			return this.computeSplits(newAmount, splits, "EQUAL", paidBy);
		}

		const result = splits.map((p) => {
			const oldCents = Math.round(p.shareAmount * 100);
			return {
				participantType: p.participantType,
				participantId: p.participantId,
				cents: Math.floor((newTotalCents * oldCents) / oldTotalCents),
			};
		});

		let remainder = newTotalCents - result.reduce((s, r) => s + r.cents, 0);
		if (remainder !== 0) {
			const payerIdx = result.findIndex((r) => sameParticipant(r, paidBy));
			const idx = payerIdx >= 0 ? payerIdx : result.length - 1;
			result[idx]!.cents += remainder;
			remainder = 0;
		}

		return result.map((r) => ({
			participantType: r.participantType,
			participantId: r.participantId,
			shareAmount: r.cents / 100,
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
