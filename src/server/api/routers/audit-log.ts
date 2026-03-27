import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { formatCurrency } from "~/lib/currency-format";
import {
	assertGuestProjectScope,
	assertWritableParticipant,
	createTRPCRouter,
	guestOrProtectedProcedure,
	protectedProcedure,
} from "~/server/api/trpc";
import { db as globalDb } from "~/server/db";
import { AuditAction, ParticipantType } from "~prisma";
import { getImageUrl } from "~/server/storage";
import { requireProjectRole } from "~/server/services/shared-expenses/project-permissions";
import {
	buildCreationSnapshot,
	formatAuditEntry,
	formatFieldChanges,
	formatRelativeTime,
	type RawAuditEntry,
	type TimelineDetail,
	resolveActorName,
} from "~/server/services/shared-expenses/audit-log-formatter";

// ── Activity Feed Types & Helpers ──────────────────────────────────────────────

type ActivityEntry = {
	id: string;
	timestamp: string;
	relativeTime: string;
	actor: {
		name: string;
		type: "user" | "guest" | "system" | "unknown";
		id: string | null;
		avatarUrl: string | null;
	};
	action: {
		type: string;
		label: string;
		icon: string;
		color: string;
	};
	summary: string;
	target: {
		type: string;
		id: string;
		label: string | null;
	};
	detail: TimelineDetail | null;
};

const ACTIVITY_SYSTEM_SENTINEL = "__system__";

const ACTIVITY_ACTION_LABELS: Record<string, string> = {
	CREATED: "Added",
	EDITED: "Edited",
	DELETED: "Deleted",
	VERIFIED: "Verified",
	REJECTED: "Disputed",
	AUTO_VERIFIED: "Auto-verified",
	SETTLED: "Settled",
	PERIOD_CLOSED: "Period closed",
	PARTICIPANT_ADDED: "Participant added",
	PARTICIPANT_REMOVED: "Participant removed",
	ROLE_CHANGED: "Role changed",
};

async function resolveActorAvatarUrl(
	actorType: string,
	actorId: string,
	cache: Map<string, string | null>,
): Promise<string | null> {
	if (actorId === ACTIVITY_SYSTEM_SENTINEL) return null;
	const key = `${actorType}:${actorId}`;
	if (cache.has(key)) return cache.get(key) ?? null;
	let url: string | null = null;
	try {
		if (actorType === "user") {
			const u = await globalDb.user.findUnique({
				where: { id: actorId },
				select: { avatarPath: true, image: true },
			});
			url = getImageUrl(u?.avatarPath ?? null) ?? u?.image ?? null;
		}
	} catch {
		// ignore
	}
	cache.set(key, url);
	return url;
}

function safeFormatAmount(amount: unknown, currency: unknown): string {
	try {
		const n = Number(amount);
		const c = String(currency ?? "USD");
		if (isNaN(n)) return String(amount);
		return formatCurrency(n, c);
	} catch {
		return String(amount);
	}
}

function truncateSummaryText(s: string, max: number): string {
	return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function getActivityActionMeta(
	action: string,
	targetType: string,
): { label: string; icon: string; color: string } {
	if (action === "CREATED") {
		if (targetType === "SHARED_TRANSACTION")
			return { label: "Added expense", icon: "plus-circle", color: "green" };
		if (targetType === "SETTLEMENT")
			return {
				label: "Initiated settlement",
				icon: "arrow-right",
				color: "green",
			};
		return { label: "Created", icon: "plus-circle", color: "green" };
	}
	if (action === "EDITED")
		return { label: "Edited expense", icon: "pencil", color: "amber" };
	if (action === "DELETED") {
		if (targetType === "SHARED_TRANSACTION")
			return { label: "Deleted expense", icon: "trash", color: "gray" };
		return { label: "Deleted", icon: "trash", color: "gray" };
	}
	if (action === "VERIFIED")
		return { label: "Verified", icon: "check-circle", color: "blue" };
	if (action === "REJECTED")
		return { label: "Disputed", icon: "x-circle", color: "red" };
	if (action === "AUTO_VERIFIED")
		return { label: "Auto-verified", icon: "clock", color: "sky" };
	if (action === "SETTLED") {
		if (targetType === "SETTLEMENT")
			return {
				label: "Settlement confirmed",
				icon: "check",
				color: "green",
			};
		return { label: "Period settled", icon: "check", color: "blue" };
	}
	if (action === "PERIOD_CLOSED")
		return { label: "Period closed", icon: "lock", color: "amber" };
	if (action === "PARTICIPANT_ADDED")
		return { label: "Participant added", icon: "user-plus", color: "blue" };
	if (action === "PARTICIPANT_REMOVED")
		return { label: "Participant removed", icon: "user-minus", color: "gray" };
	if (action === "ROLE_CHANGED")
		return { label: "Role changed", icon: "shield", color: "amber" };
	return { label: action, icon: "activity", color: "gray" };
}

function buildActivitySummary(
	action: string,
	targetType: string,
	actorName: string,
	txnDescription: string | null,
	txnCurrency: string | null,
	changes: unknown,
	otherActorName: string | null,
	billingPeriodLabel: string | null,
): string {
	const c = changes as Record<string, unknown> | null;
	try {
		switch (action) {
			case "CREATED": {
				if (targetType === "SHARED_TRANSACTION") {
					const desc = txnDescription ? `'${txnDescription}'` : "an expense";
					const amt = c ? ` (${safeFormatAmount(c.amount, c.currency)})` : "";
					return `${actorName} added ${desc}${amt}`;
				}
				if (targetType === "SETTLEMENT") {
					const amt = safeFormatAmount(c?.amount, c?.currency);
					const to = otherActorName ? ` with ${otherActorName}` : "";
					return `${actorName} initiated a ${amt} settlement${to}`;
				}
				return `${actorName} created the project`;
			}

			case "EDITED": {
				if (targetType === "SHARED_TRANSACTION") {
					const desc = txnDescription
						? `'${truncateSummaryText(txnDescription, 40)}'`
						: "an expense";
					const amtChange = c?.amount as
						| { old: unknown; new: unknown }
						| undefined;
					const descChange = c?.description as
						| { old: string; new: string }
						| undefined;
					const splitChange = c?.splitParticipants;

					if (amtChange) {
						const currencyChange = c?.currency as
							| { old: string; new: string }
							| undefined;
						const currency = currencyChange?.new ?? txnCurrency ?? "USD";
						const from = safeFormatAmount(amtChange.old, currency);
						const to = safeFormatAmount(amtChange.new, currency);
						if (splitChange) {
							return `${actorName} changed ${desc} from ${from} to ${to} and updated the split`;
						}
						return `${actorName} changed ${desc} from ${from} to ${to}`;
					}
					if (descChange) {
						const oldLabel = descChange.old
							? `'${truncateSummaryText(descChange.old, 40)}'`
							: "an expense";
						const newLabel = descChange.new
							? `'${truncateSummaryText(descChange.new, 40)}'`
							: "an expense";
						return `${actorName} renamed ${oldLabel} to ${newLabel}`;
					}
					if (splitChange) {
						return `${actorName} updated the split on ${desc}`;
					}
					return `${actorName} edited ${desc}`;
				}

				// PROJECT EDITED - parse field-level diff for specific summaries
				const nameChange = c?.name as { old: string; new: string } | undefined;
				const imageChange = c?.imagePath as
					| { old: string | null; new: string | null }
					| undefined;
				const budgetChange = c?.budgetAmount as
					| { old: unknown; new: unknown }
					| undefined;
				const visChange = c?.visibility as
					| { old: string; new: string }
					| undefined;
				const hasDateChange = !!(c?.startDate ?? c?.endDate);
				const descChange2 = c?.description as
					| { old: unknown; new: unknown }
					| undefined;
				const hasBillingChange = !!(
					c?.billingCycleLength ??
					c?.billingCycleDays ??
					c?.billingAutoClose ??
					c?.billingCloseReminderDays ??
					c?.billingClosePermission
				);

				const labels: string[] = [];

				if (nameChange) {
					const from = truncateSummaryText(String(nameChange.old), 35);
					const to = truncateSummaryText(String(nameChange.new), 35);
					labels.push(`renamed the project from '${from}' to '${to}'`);
				}
				if (imageChange) {
					if (!imageChange.old && imageChange.new)
						labels.push("added a project icon");
					else if (imageChange.old && !imageChange.new)
						labels.push("removed the project icon");
					else labels.push("changed the project icon");
				}
				if (budgetChange) {
					if (budgetChange.new == null) labels.push("removed the project budget");
					else if (budgetChange.old == null) labels.push("set a project budget");
					else labels.push("changed the project budget");
				}
				if (visChange) {
					const vis = String(visChange.new).toLowerCase().replace(/_/g, " ");
					labels.push(`changed project visibility to ${vis}`);
				}
				if (hasDateChange) labels.push("updated the project dates");
				if (descChange2 && !nameChange)
					labels.push("updated the project description");
				if (hasBillingChange && labels.length === 0)
					labels.push("updated billing period settings");

				if (labels.length === 0) return `${actorName} updated the project`;
				if (labels.length === 1) return `${actorName} ${labels[0]}`;
				if (labels.length === 2)
					return `${actorName} ${labels[0]} and ${labels[1]}`;
				const extra = labels.length - 2;
				return `${actorName} ${labels[0]} and ${labels[1]} (and ${extra} more ${extra === 1 ? "change" : "changes"})`;
			}

			case "DELETED": {
				if (targetType === "SHARED_TRANSACTION") {
					const desc = txnDescription ? `'${txnDescription}'` : "an expense";
					const amt = c?.amount
						? ` (${safeFormatAmount(c.amount, c.currency)})`
						: "";
					return `${actorName} deleted ${desc}${amt}`;
				}
				return `${actorName} deleted`;
			}

			case "VERIFIED":
				return txnDescription
					? `${actorName} verified '${txnDescription}'`
					: `${actorName} verified an expense`;

			case "REJECTED": {
				const reason = typeof c?.reason === "string" ? c.reason : null;
				const desc = txnDescription ? `'${txnDescription}'` : "an expense";
				if (reason) {
					const truncated =
						reason.length > 80 ? reason.slice(0, 77) + "…" : reason;
					return `${actorName} disputed ${desc}: '${truncated}'`;
				}
				return `${actorName} disputed ${desc}`;
			}

			case "AUTO_VERIFIED": {
				const days =
					typeof c?.autoAcceptedAfterDays === "number"
						? c.autoAcceptedAfterDays
						: 7;
				const desc = txnDescription ? `'${txnDescription}'` : "An expense";
				return `${desc} auto-verified after ${days} days`;
			}

			case "SETTLED": {
				if (targetType === "SETTLEMENT") {
					const amt = safeFormatAmount(c?.amount, c?.currency);
					const from = otherActorName ? ` from ${otherActorName}` : "";
					return `${actorName} confirmed a ${amt} settlement${from}`;
				}
				if (targetType === "BILLING_PERIOD") {
					return billingPeriodLabel
						? `${actorName} settled the '${billingPeriodLabel}' period`
						: `${actorName} settled a billing period`;
				}
				return `${actorName} settled`;
			}

			case "PERIOD_CLOSED":
				return billingPeriodLabel
					? `${actorName} closed the '${billingPeriodLabel}' billing period`
					: `${actorName} closed a billing period`;

			case "PARTICIPANT_ADDED":
				return otherActorName
					? `${actorName} added ${otherActorName} to the project`
					: `${actorName} added a participant`;

			case "PARTICIPANT_REMOVED":
				return otherActorName
					? `${actorName} removed ${otherActorName} from the project`
					: `${actorName} removed a participant`;

			case "ROLE_CHANGED": {
				const oldRole = typeof c?.oldRole === "string" ? c.oldRole : null;
				const newRole = typeof c?.newRole === "string" ? c.newRole : null;
				const roleStr =
					oldRole && newRole ? ` from ${oldRole} to ${newRole}` : "";
				return otherActorName
					? `${actorName} changed ${otherActorName}'s role${roleStr}`
					: `${actorName} changed a participant's role`;
			}

			default:
				return `${actorName} made a change`;
		}
	} catch {
		return `${actorName} made a change`;
	}
}

async function formatActivityEntry(
	entry: RawAuditEntry,
	actorName: string,
	actorAvatarUrl: string | null,
	txnMap: Map<string, { description: string; amount: number; currency: string }>,
	periodMap: Map<string, { label: string }>,
	splitParticipantTxnMap: Map<string, string>,
	nameCache: Map<string, string>,
): Promise<ActivityEntry> {
	const c = entry.changes as Record<string, unknown> | null;

	// Resolve "other actor" for participant/settlement entries
	let otherActorName: string | null = null;
	try {
		if (
			entry.action === "PARTICIPANT_ADDED" ||
			entry.action === "PARTICIPANT_REMOVED" ||
			entry.action === "ROLE_CHANGED"
		) {
			const pType = c?.participantType as string | undefined;
			const pId = c?.participantId as string | undefined;
			if (pType && pId) {
				otherActorName = await resolveActorName(
					globalDb,
					pType,
					pId,
					nameCache,
				);
			}
		} else if (
			entry.action === "CREATED" &&
			entry.targetType === "SETTLEMENT"
		) {
			const toType = c?.toParticipantType as string | undefined;
			const toId = c?.toParticipantId as string | undefined;
			if (toType && toId) {
				otherActorName = await resolveActorName(
					globalDb,
					toType,
					toId,
					nameCache,
				);
			}
		} else if (
			entry.action === "SETTLED" &&
			entry.targetType === "SETTLEMENT"
		) {
			const fromType = c?.fromParticipantType as string | undefined;
			const fromId = c?.fromParticipantId as string | undefined;
			if (fromType && fromId) {
				otherActorName = await resolveActorName(
					globalDb,
					fromType,
					fromId,
					nameCache,
				);
			}
		}
	} catch {
		// ignore
	}

	// Resolve transaction context
	let txnDescription: string | null = null;
	let txnCurrency: string | null = null;
	let billingPeriodLabel: string | null = null;

	if (entry.targetType === "SHARED_TRANSACTION") {
		// CREATED/DELETED carry the full snapshot in changes; others need the live record
		if (entry.action === "CREATED" || entry.action === "DELETED") {
			txnDescription = typeof c?.description === "string" ? c.description : null;
			txnCurrency = typeof c?.currency === "string" ? c.currency : null;
		} else {
			const txn = txnMap.get(entry.targetId);
			txnDescription = txn?.description ?? null;
			txnCurrency = txn?.currency ?? null;
		}
	} else if (entry.targetType === "SPLIT_PARTICIPANT") {
		// AUTO_VERIFIED - resolve via split participant to transaction mapping
		const txnId = splitParticipantTxnMap.get(entry.targetId);
		if (txnId) {
			const txn = txnMap.get(txnId);
			txnDescription = txn?.description ?? null;
			txnCurrency = txn?.currency ?? null;
		}
	} else if (entry.targetType === "BILLING_PERIOD") {
		billingPeriodLabel = periodMap.get(entry.targetId)?.label ?? null;
	}

	// Build expandable detail
	let detail: TimelineDetail | null = null;
	try {
		if (entry.targetType === "SHARED_TRANSACTION") {
			if (entry.action === "CREATED") {
				const snapshot = await buildCreationSnapshot(
					entry.changes,
					globalDb,
					nameCache,
				);
				if (snapshot) detail = { type: "creation_snapshot", snapshot };
			} else if (entry.action === "DELETED") {
				const snapshot = await buildCreationSnapshot(
					entry.changes,
					globalDb,
					nameCache,
				);
				if (snapshot) detail = { type: "deletion_snapshot", snapshot };
			} else if (entry.action === "EDITED") {
				const fieldChanges = await formatFieldChanges(
					entry.changes,
					txnCurrency ?? "USD",
					globalDb,
					nameCache,
				);
				if (fieldChanges?.length)
					detail = { type: "field_changes", changes: fieldChanges };
			} else if (entry.action === "REJECTED") {
				const reason = typeof c?.reason === "string" ? c.reason : null;
				if (reason) detail = { type: "rejection", reason };
			}
		}
	} catch {
		// ignore
	}

	// Map targetType to frontend-friendly type, handling SPLIT_PARTICIPANT → transaction
	let target: { type: string; id: string; label: string | null };
	if (entry.targetType === "SHARED_TRANSACTION") {
		target = { type: "transaction", id: entry.targetId, label: txnDescription };
	} else if (entry.targetType === "SETTLEMENT") {
		target = { type: "settlement", id: entry.targetId, label: null };
	} else if (entry.targetType === "PROJECT") {
		target = { type: "project", id: entry.targetId, label: null };
	} else if (entry.targetType === "BILLING_PERIOD") {
		target = {
			type: "billing_period",
			id: entry.targetId,
			label: billingPeriodLabel,
		};
	} else if (entry.targetType === "SPLIT_PARTICIPANT") {
		const txnId = splitParticipantTxnMap.get(entry.targetId);
		if (txnId) {
			target = { type: "transaction", id: txnId, label: txnDescription };
		} else {
			target = { type: "split_participant", id: entry.targetId, label: null };
		}
	} else {
		target = {
			type: entry.targetType.toLowerCase(),
			id: entry.targetId,
			label: null,
		};
	}

	const actorDisplayType: "user" | "guest" | "system" | "unknown" =
		entry.actorId === ACTIVITY_SYSTEM_SENTINEL
			? "system"
			: entry.actorType === "user"
				? "user"
				: entry.actorType === "guest"
					? "guest"
					: "unknown";

	const actionMeta = getActivityActionMeta(entry.action, entry.targetType);
	const summary = buildActivitySummary(
		entry.action,
		entry.targetType,
		actorName,
		txnDescription,
		txnCurrency,
		entry.changes,
		otherActorName,
		billingPeriodLabel,
	);

	return {
		id: entry.id,
		timestamp: entry.timestamp.toISOString(),
		relativeTime: formatRelativeTime(entry.timestamp),
		actor: {
			name: actorName,
			type: actorDisplayType,
			id: entry.actorId === ACTIVITY_SYSTEM_SENTINEL ? null : entry.actorId,
			avatarUrl: actorAvatarUrl,
		},
		action: {
			type: entry.action.toLowerCase(),
			...actionMeta,
		},
		summary,
		target,
		detail,
	};
}

/**
 * Batch-formats an array of raw audit entries into ActivityEntry objects.
 * Pre-fetches all referenced transactions, billing periods, split participants,
 * and actor names/avatars in bulk to avoid N+1 queries.
 */
async function batchFormatActivityEntries(
	rawEntries: RawAuditEntry[],
): Promise<ActivityEntry[]> {
	if (rawEntries.length === 0) return [];

	// Collect IDs to batch-fetch
	const txnIdsToFetch = new Set<string>();
	const splitParticipantIds = new Set<string>();
	const periodIds = new Set<string>();

	for (const entry of rawEntries) {
		if (entry.targetType === "SHARED_TRANSACTION") {
			// CREATED/DELETED use the snapshot in changes; others need the live record
			if (entry.action !== "CREATED" && entry.action !== "DELETED") {
				txnIdsToFetch.add(entry.targetId);
			}
		} else if (entry.targetType === "SPLIT_PARTICIPANT") {
			splitParticipantIds.add(entry.targetId);
		} else if (entry.targetType === "BILLING_PERIOD") {
			periodIds.add(entry.targetId);
		}
	}

	// Resolve split participants → transactionIds, then add those txnIds to the batch
	const splitParticipantTxnMap = new Map<string, string>(); // spId → txnId
	if (splitParticipantIds.size > 0) {
		const sps = await globalDb.splitParticipant.findMany({
			where: { id: { in: [...splitParticipantIds] } },
			select: { id: true, transactionId: true },
		});
		for (const sp of sps) {
			splitParticipantTxnMap.set(sp.id, sp.transactionId);
			txnIdsToFetch.add(sp.transactionId);
		}
	}

	// Batch-fetch transactions
	const txnMap = new Map<
		string,
		{ description: string; amount: number; currency: string }
	>();
	if (txnIdsToFetch.size > 0) {
		const txns = await globalDb.sharedTransaction.findMany({
			where: { id: { in: [...txnIdsToFetch] } },
			select: { id: true, description: true, amount: true, currency: true },
		});
		for (const txn of txns) {
			txnMap.set(txn.id, {
				description: txn.description,
				amount: Number(txn.amount),
				currency: txn.currency,
			});
		}
	}

	// Batch-fetch billing periods
	const periodMap = new Map<string, { label: string }>();
	if (periodIds.size > 0) {
		const periods = await globalDb.billingPeriod.findMany({
			where: { id: { in: [...periodIds] } },
			select: { id: true, label: true },
		});
		for (const period of periods) {
			periodMap.set(period.id, { label: period.label });
		}
	}

	// Pre-resolve all actor names and avatars to populate the caches
	const nameCache = new Map<string, string>();
	const avatarCache = new Map<string, string | null>();

	const uniqueActors = new Map<string, { type: string; id: string }>();
	for (const entry of rawEntries) {
		const key = `${entry.actorType}:${entry.actorId}`;
		if (!uniqueActors.has(key)) {
			uniqueActors.set(key, { type: entry.actorType, id: entry.actorId });
		}
	}
	await Promise.all(
		[...uniqueActors.values()].map(async ({ type, id }) => {
			await resolveActorName(globalDb, type, id, nameCache);
			await resolveActorAvatarUrl(type, id, avatarCache);
		}),
	);

	// Format each entry, sharing the pre-populated caches
	return Promise.all(
		rawEntries.map(async (entry) => {
			const actorName = await resolveActorName(
				globalDb,
				entry.actorType,
				entry.actorId,
				nameCache,
			);
			const actorAvatarUrl = await resolveActorAvatarUrl(
				entry.actorType,
				entry.actorId,
				avatarCache,
			);
			return formatActivityEntry(
				entry,
				actorName,
				actorAvatarUrl,
				txnMap,
				periodMap,
				splitParticipantTxnMap,
				nameCache,
			);
		}),
	);
}

// ─────────────────────────────────────────────────────────────────────────────

export const auditLogRouter = createTRPCRouter({
	/**
	 * Returns the full revision history timeline for a single shared transaction.
	 *
	 * Authorization: the caller must be a participant (split member, payer, or
	 * creator). For deleted transactions, participation is verified from the
	 * stored audit snapshot. For guests, the transaction must belong to their
	 * project scope.
	 */
	transactionHistory: guestOrProtectedProcedure
		.input(z.object({ transactionId: z.string() }))
		.query(async ({ ctx, input }) => {
			const { transactionId } = input;
			const participant = ctx.participant;

			// Fetch the live transaction (null if hard-deleted)
			const transaction = await globalDb.sharedTransaction.findUnique({
				where: { id: transactionId },
				include: { splitParticipants: true },
			});

			// Fetch all audit entries for this transaction (needed for auth on
			// deleted transactions as well as the timeline itself)
			const entries = await globalDb.auditLogEntry.findMany({
				where: {
					targetType: "SHARED_TRANSACTION",
					targetId: transactionId,
				},
				orderBy: { timestamp: "asc" },
			});

			// ── Authorization ──────────────────────────────────────────────────
			if (participant.participantType === "user") {
				const userId = participant.participantId;

				if (transaction) {
					const isParticipant =
						transaction.splitParticipants.some(
							(sp) =>
								sp.participantType === "user" && sp.participantId === userId,
						) ||
						(transaction.paidByType === "user" &&
							transaction.paidById === userId) ||
						(transaction.createdByType === "user" &&
							transaction.createdById === userId);

					if (!isParticipant && transaction.projectId) {
						// Check project membership
						const inProject =
							await globalDb.projectParticipant.findFirst({
								where: {
									projectId: transaction.projectId,
									participantType: "user",
									participantId: userId,
								},
								select: { id: true },
							});
						if (!inProject)
							throw new TRPCError({ code: "FORBIDDEN" });
					} else if (!isParticipant) {
						throw new TRPCError({ code: "FORBIDDEN" });
					}
				} else {
					// Hard-deleted transaction: verify from snapshot in audit log
					if (entries.length === 0) throw new TRPCError({ code: "NOT_FOUND" });

					// Look in DELETED entry first, then CREATED
					const snapshotEntry =
						entries.find((e) => e.action === "DELETED") ??
						entries.find((e) => e.action === "CREATED");

					const snap = snapshotEntry?.changes as Record<string, unknown> | null;
					const sps = snap?.splitParticipants as
						| Array<{ participantType: string; participantId: string }>
						| undefined;

					const inSnapshot =
						(snap?.paidByType === "user" && snap?.paidById === userId) ||
						(snap?.createdByType === "user" && snap?.createdById === userId) ||
						(Array.isArray(sps) &&
							sps.some(
								(sp) =>
									sp.participantType === "user" && sp.participantId === userId,
							));

					if (!inSnapshot) throw new TRPCError({ code: "FORBIDDEN" });
				}
			} else if (
				participant.participantType === "guest" ||
				participant.participantType === "viewerLink"
			) {
				// Guests and viewer-link participants can only see transactions in their project
				if (!transaction) throw new TRPCError({ code: "NOT_FOUND" });
				if (transaction.projectId !== participant.projectScope) {
					throw new TRPCError({ code: "FORBIDDEN" });
				}
			}

			// ── Determine display currency ─────────────────────────────────────
			let currency = transaction?.currency ?? "USD";
			if (!transaction) {
				// Pull from CREATED snapshot
				const createdEntry = entries.find((e) => e.action === "CREATED");
				const c = createdEntry?.changes as Record<string, unknown> | null;
				if (typeof c?.currency === "string") currency = c.currency;
			}

			// ── Format timeline entries ────────────────────────────────────────
			// Shared cache so repeated actors are resolved only once
			const nameCache = new Map<string, string>();
			const formattedEntries = await Promise.all(
				entries.map((e) =>
					formatAuditEntry(e as RawAuditEntry, currency, globalDb, nameCache),
				),
			);

			// ── Build transaction header ───────────────────────────────────────
			let transactionInfo: {
				id: string;
				description: string;
				amount: string;
				currency: string;
				isDeleted: boolean;
				isLocked: boolean;
			};

			if (transaction) {
				transactionInfo = {
					id: transaction.id,
					description: transaction.description,
					amount: formatCurrency(
						Number(transaction.amount),
						transaction.currency,
					),
					currency: transaction.currency,
					isDeleted: false,
					isLocked: transaction.isLocked,
				};
			} else {
				// Reconstruct from CREATED snapshot
				const c = (entries.find((e) => e.action === "CREATED")?.changes ??
					{}) as Record<string, unknown>;
				transactionInfo = {
					id: transactionId,
					description:
						(c.description as string | undefined) ?? "Deleted expense",
					amount:
						c.amount !== undefined
							? formatCurrency(Number(c.amount), String(c.currency ?? "USD"))
							: "-",
					currency: (c.currency as string | undefined) ?? "USD",
					isDeleted: true,
					isLocked: false,
				};
			}

			// Auto-mark as seen when viewing revision history (only if transaction exists)
			const validSplitParticipantTypes = ["user", "guest", "shadow"] as const;
			if (
				transaction &&
				(validSplitParticipantTypes as readonly string[]).includes(
					participant.participantType,
				)
			) {
				await globalDb.splitParticipant.updateMany({
					where: {
						transactionId: input.transactionId,
						participantType: participant.participantType as
							| "user"
							| "guest"
							| "shadow",
						participantId: participant.participantId,
						hasUnseenChanges: true,
					},
					data: { hasUnseenChanges: false },
				});
			}

			return {
				transaction: transactionInfo,
				entries: formattedEntries,
				totalEntries: entries.length,
			};
		}),

	// ── Project Activity Feed ──────────────────────────────────────────────────

	/**
	 * Paginated, filterable activity feed for a project.
	 * Returns all AuditLogEntry records for the project, newest-first,
	 * formatted as ActivityEntry objects with avatar URLs, target labels, etc.
	 *
	 * Authorization: caller must be a project participant (any role).
	 * Guests: project must match their session scope.
	 */
	projectActivityFeed: guestOrProtectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				cursor: z.string().optional(),
				limit: z.number().int().min(1).max(100).default(50),
				filters: z
					.object({
						actions: z.array(z.nativeEnum(AuditAction)).optional(),
						actorId: z.string().optional(),
						actorType: z.nativeEnum(ParticipantType).optional(),
					})
					.optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			assertGuestProjectScope(ctx.participant, input.projectId);
			const { participantType, participantId } = ctx.participant;
			await requireProjectRole(
				globalDb,
				input.projectId,
				participantType as "user" | "guest" | "shadow",
				participantId,
				"VIEWER",
			);

			const { projectId, cursor, limit, filters } = input;

			// Base where - used for totalCount (no cursor)
			const baseWhere = {
				projectId,
				...(filters?.actions?.length
					? { action: { in: filters.actions } }
					: {}),
				...(filters?.actorId && filters?.actorType
					? { actorType: filters.actorType, actorId: filters.actorId }
					: {}),
			};

			// Paginated where - adds cursor for id-based pagination
			const paginatedWhere = {
				...baseWhere,
				...(cursor ? { id: { lt: cursor } } : {}),
			};

			const [rawEntries, totalCount] = await Promise.all([
				globalDb.auditLogEntry.findMany({
					where: paginatedWhere,
					orderBy: { timestamp: "desc" },
					take: limit + 1,
				}),
				globalDb.auditLogEntry.count({ where: baseWhere }),
			]);

			const hasNextPage = rawEntries.length > limit;
			const entriesToFormat = hasNextPage
				? rawEntries.slice(0, limit)
				: rawEntries;
			const nextCursor =
				hasNextPage ? (entriesToFormat.at(-1)?.id ?? null) : null;

			const entries = await batchFormatActivityEntries(
				entriesToFormat as RawAuditEntry[],
			);

			return { entries, nextCursor, totalCount };
		}),

	/**
	 * Returns the single most recent activity entry for a project.
	 * Used on project list cards to show "what happened last".
	 */
	projectLastActivity: protectedProcedure
		.input(z.object({ projectId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			await requireProjectRole(
				globalDb,
				input.projectId,
				"user",
				userId,
				"VIEWER",
			);

			const entry = await globalDb.auditLogEntry.findFirst({
				where: { projectId: input.projectId },
				orderBy: { timestamp: "desc" },
			});

			if (!entry) return null;

			const [formatted] = await batchFormatActivityEntries([
				entry as RawAuditEntry,
			]);
			return formatted ?? null;
		}),

	/**
	 * Returns filter metadata for the project activity feed:
	 * distinct actors with resolved names/avatars, and action types with counts.
	 */
	projectActivityFilters: guestOrProtectedProcedure
		.input(z.object({ projectId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			assertGuestProjectScope(ctx.participant, input.projectId);
			const { participantType, participantId } = ctx.participant;
			await requireProjectRole(
				globalDb,
				input.projectId,
				participantType as "user" | "guest" | "shadow",
				participantId,
				"VIEWER",
			);

			const [actorGroups, actionGroups] = await Promise.all([
				globalDb.auditLogEntry.groupBy({
					by: ["actorType", "actorId"],
					where: { projectId: input.projectId },
					_count: { _all: true },
				}),
				globalDb.auditLogEntry.groupBy({
					by: ["action"],
					where: { projectId: input.projectId },
					_count: { _all: true },
				}),
			]);

			const nameCache = new Map<string, string>();
			const avatarCache = new Map<string, string | null>();

			const actors = await Promise.all(
				actorGroups.map(async (group) => {
					const name = await resolveActorName(
						globalDb,
						group.actorType,
						group.actorId,
						nameCache,
					);
					const avatarUrl = await resolveActorAvatarUrl(
						group.actorType,
						group.actorId,
						avatarCache,
					);
					return {
						type: group.actorType,
						id: group.actorId,
						name,
						avatarUrl,
					};
				}),
			);

			const actionTypes = actionGroups.map((group) => ({
				value: group.action as AuditAction,
				label: ACTIVITY_ACTION_LABELS[group.action] ?? group.action,
				count: group._count._all,
			}));

			return { actors, actionTypes };
		}),

	/**
	 * Explicitly marks a transaction's changes as seen for the current participant.
	 * No-op if the participant has no unseen changes or isn't a split participant.
	 */
	markTransactionSeen: guestOrProtectedProcedure
		.input(z.object({ transactionId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const { participantType, participantId } =
				assertWritableParticipant(ctx.participant);
			await globalDb.splitParticipant.updateMany({
				where: {
					transactionId: input.transactionId,
					participantType,
					participantId,
					hasUnseenChanges: true,
				},
				data: { hasUnseenChanges: false },
			});
			return { success: true };
		}),

	/**
	 * Batch query returning edit counts and last-editor info for multiple
	 * transaction IDs. Used by transaction lists to show "Edited" indicators
	 * without N+1 individual queries.
	 *
	 * Returns a map of transactionId → { editCount, lastEditedAt, lastEditedBy }.
	 * Transaction IDs with zero edits are omitted from the result.
	 */
	transactionRevisionSummary: guestOrProtectedProcedure
		.input(z.object({ transactionIds: z.array(z.string()).max(100) }))
		.query(async ({ ctx, input }) => {
			const { transactionIds } = input;
			if (transactionIds.length === 0) return {};

			const participant = ctx.participant;

			// ── Authorization ──────────────────────────────────────────────────
			if (participant.participantType === "user") {
				const userId = participant.participantId;

				// Check if user is a split participant in any of these transactions
				const inSplit = await globalDb.splitParticipant.findFirst({
					where: {
						transactionId: { in: transactionIds },
						participantType: "user",
						participantId: userId,
					},
					select: { id: true },
				});

				if (!inSplit) {
					// Also check as payer or creator
					const asPayerOrCreator = await globalDb.sharedTransaction.findFirst({
						where: {
							id: { in: transactionIds },
							OR: [
								{ paidByType: "user", paidById: userId },
								{ createdByType: "user", createdById: userId },
							],
						},
						select: { id: true },
					});

					if (!asPayerOrCreator) {
						// Also check as project participant
						const asProjectMember =
							await globalDb.sharedTransaction.findFirst({
								where: {
									id: { in: transactionIds },
									projectId: { not: null },
									project: {
										participants: {
											some: {
												participantType: "user",
												participantId: userId,
											},
										},
									},
								},
								select: { id: true },
							});
						if (!asProjectMember)
							throw new TRPCError({ code: "FORBIDDEN" });
					}
				}
			} else if (participant.participantType === "guest") {
				// All requested transactions must belong to the guest's project
				const txns = await globalDb.sharedTransaction.findMany({
					where: { id: { in: transactionIds } },
					select: { id: true, projectId: true },
				});
				const allInScope = txns.every(
					(t) => t.projectId === participant.projectScope,
				);
				if (!allInScope) throw new TRPCError({ code: "FORBIDDEN" });
			}

			// ── Fetch EDITED entries for all requested transactions ─────────────
			// Order desc so the first entry seen per targetId is the most recent
			const editedEntries = await globalDb.auditLogEntry.findMany({
				where: {
					targetType: "SHARED_TRANSACTION",
					targetId: { in: transactionIds },
					action: "EDITED",
				},
				select: {
					targetId: true,
					actorType: true,
					actorId: true,
					timestamp: true,
				},
				orderBy: { timestamp: "desc" },
			});

			// Group by targetId; first entry per id is the latest (desc order)
			const grouped = new Map<
				string,
				{
					count: number;
					lastTimestamp: Date;
					lastActorType: string;
					lastActorId: string;
				}
			>();

			for (const entry of editedEntries) {
				const existing = grouped.get(entry.targetId);
				if (!existing) {
					grouped.set(entry.targetId, {
						count: 1,
						lastTimestamp: entry.timestamp,
						lastActorType: entry.actorType,
						lastActorId: entry.actorId,
					});
				} else {
					existing.count++;
					// Don't update timestamp: first seen is already the latest
				}
			}

			// ── Resolve actor names for last editors ───────────────────────────
			const nameCache = new Map<string, string>();
			const result: Record<
				string,
				{
					editCount: number;
					lastEditedAt: string | null;
					lastEditedBy: string | null;
				}
			> = {};

			for (const [txnId, data] of grouped) {
				const actorName = await resolveActorName(
					globalDb,
					data.lastActorType,
					data.lastActorId,
					nameCache,
				);
				result[txnId] = {
					editCount: data.count,
					lastEditedAt: data.lastTimestamp.toISOString(),
					lastEditedBy: actorName,
				};
			}

			return result;
		}),
});
