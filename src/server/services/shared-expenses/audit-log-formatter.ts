import { formatCurrency } from "~/lib/currency-format";
import type { PrismaClient } from "~prisma";

// ── Output Types ──────────────────────────────────────────────────────────────

export type FieldChange = {
	field: string;
	label: string;
	oldValue: string;
	newValue: string;
};

export type CreationSnapshot = {
	amount: string;
	currency: string;
	description: string;
	category: string | null;
	date: string;
	splitMode: string;
	paidBy: string;
	participants: { name: string; share: string }[];
};

export type TimelineDetail =
	| { type: "field_changes"; changes: FieldChange[] }
	| { type: "creation_snapshot"; snapshot: CreationSnapshot }
	| { type: "deletion_snapshot"; snapshot: CreationSnapshot }
	| { type: "rejection"; reason: string | null }
	| { type: "verification"; note: string | null };

export type TimelineEntry = {
	id: string;
	timestamp: string;
	relativeTime: string;
	actor: {
		name: string;
		type: "user" | "guest" | "system" | "unknown";
		id: string | null;
	};
	action: {
		type: string;
		label: string;
		color: string;
		icon: string;
	};
	summary: string;
	detail: TimelineDetail | null;
};

// ── Date / Time Formatting ────────────────────────────────────────────────────

export function formatAuditDate(date: Date | string): string {
	const d = typeof date === "string" ? new Date(date) : date;
	if (isNaN(d.getTime())) return String(date);
	return d.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

export function formatAuditDateTime(date: Date): string {
	return date.toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	});
}

export function formatRelativeTime(date: Date): string {
	const diffMs = Date.now() - date.getTime();
	const diffMinutes = Math.floor(diffMs / 60_000);
	const diffHours = Math.floor(diffMinutes / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffDays >= 7) return formatAuditDateTime(date);
	if (diffDays >= 2) return `${diffDays} days ago`;
	if (diffDays === 1) return "yesterday";
	if (diffHours >= 1)
		return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
	if (diffMinutes >= 1)
		return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
	return "just now";
}

export function formatSplitMode(mode: string): string {
	const map: Record<string, string> = {
		EQUAL: "Equal",
		EXACT: "Exact",
		PERCENTAGE: "Percentage",
		SHARES: "Shares",
	};
	return map[mode.toUpperCase()] ?? mode;
}

// ── Amount Formatting ─────────────────────────────────────────────────────────

function safeFormatCurrency(amount: unknown, currency: unknown): string {
	try {
		const n = typeof amount === "number" ? amount : Number(amount);
		const c = typeof currency === "string" ? currency : "USD";
		if (isNaN(n)) return String(amount);
		return formatCurrency(n, c);
	} catch {
		return String(amount);
	}
}

// ── Actor / Category Resolution ───────────────────────────────────────────────

// Sentinel ID used by the system actor (see verification.service.ts)
const SYSTEM_SENTINEL = "__system__";
// Sentinel IDs used for deleted participants (see user-deletion.service.ts)
const DELETED_USER_SENTINEL = "DELETED_USER";
const DELETED_GUEST_SENTINEL = "DELETED_GUEST";
const DELETED_SHADOW_SENTINEL = "DELETED_SHADOW";

export async function resolveActorName(
	db: PrismaClient,
	actorType: string,
	actorId: string,
	cache: Map<string, string>,
): Promise<string> {
	if (actorId === SYSTEM_SENTINEL) return "System";
	if (actorId === DELETED_USER_SENTINEL) return "Deleted User";
	if (actorId === DELETED_GUEST_SENTINEL) return "Deleted Guest";
	if (actorId === DELETED_SHADOW_SENTINEL) return "Deleted Participant";

	const key = `${actorType}:${actorId}`;
	const hit = cache.get(key);
	if (hit !== undefined) return hit;

	let name: string | null = null;
	try {
		if (actorType === "user") {
			const u = await db.user.findUnique({
				where: { id: actorId },
				select: { name: true },
			});
			name = u?.name ?? null;
		} else if (actorType === "guest") {
			const g = await db.guestSession.findUnique({
				where: { id: actorId },
				select: { name: true },
			});
			name = g?.name ?? null;
		} else if (actorType === "shadow") {
			const s = await db.shadowProfile.findUnique({
				where: { id: actorId },
				select: { name: true },
			});
			name = s?.name ?? null;
		}
	} catch (err) {
		console.warn(
			`[audit-log] resolveActorName(${actorType}:${actorId}) failed:`,
			err,
		);
	}

	const resolved = name ?? "Unknown user";
	cache.set(key, resolved);
	return resolved;
}

// Null sentinel stored in cache so we don't re-query deleted categories
const NULL_SENTINEL = "\x00";

async function resolveCategoryName(
	db: PrismaClient,
	categoryId: string | null | undefined,
	cache: Map<string, string>,
): Promise<string | null> {
	if (!categoryId) return null;

	const key = `category:${categoryId}`;
	const hit = cache.get(key);
	if (hit !== undefined) return hit === NULL_SENTINEL ? null : hit;

	try {
		const c = await db.category.findUnique({
			where: { id: categoryId },
			select: { name: true },
		});
		const name = c?.name ?? null;
		cache.set(key, name ?? NULL_SENTINEL);
		return name;
	} catch {
		cache.set(key, NULL_SENTINEL);
		return null;
	}
}

// ── Creation / Deletion Snapshot ──────────────────────────────────────────────

/**
 * Builds a human-readable snapshot from the changes JSON stored by
 * serializeTransaction() on CREATED and DELETED audit entries.
 *
 * Actual stored shape:
 *   { id, description, amount: number, currency, date: ISO, categoryId,
 *     splitMode, paidByType, paidById, createdByType, createdById,
 *     splitParticipants: [{participantType, participantId, shareAmount, ...}] }
 */
export async function buildCreationSnapshot(
	changesJson: unknown,
	db: PrismaClient,
	nameCache: Map<string, string>,
): Promise<CreationSnapshot | null> {
	try {
		if (!changesJson || typeof changesJson !== "object") return null;
		const c = changesJson as Record<string, unknown>;

		const currency = (c.currency as string | undefined) ?? "USD";
		const paidByType = (c.paidByType as string | undefined) ?? "user";
		const paidById = (c.paidById as string | undefined) ?? "";
		const categoryId = c.categoryId as string | null | undefined;
		const sps = c.splitParticipants as
			| Array<{
					participantType: string;
					participantId: string;
					shareAmount: number;
			  }>
			| undefined;

		const [paidByName, categoryName] = await Promise.all([
			resolveActorName(db, paidByType, paidById, nameCache),
			resolveCategoryName(db, categoryId, nameCache),
		]);

		const participants: { name: string; share: string }[] = [];
		if (Array.isArray(sps)) {
			for (const p of sps) {
				const name = await resolveActorName(
					db,
					p.participantType,
					p.participantId,
					nameCache,
				);
				participants.push({
					name,
					share: safeFormatCurrency(p.shareAmount, currency),
				});
			}
		}

		return {
			amount:
				c.amount !== undefined ? safeFormatCurrency(c.amount, currency) : "-",
			currency,
			description: (c.description as string | undefined) ?? "",
			category: categoryName,
			date: c.date ? formatAuditDate(c.date as string) : "-",
			splitMode: formatSplitMode((c.splitMode as string | undefined) ?? ""),
			paidBy: paidByName,
			participants,
		};
	} catch (err) {
		console.warn("[audit-log] buildCreationSnapshot failed:", err);
		return null;
	}
}

// ── Field Change Formatter (for EDITED) ───────────────────────────────────────

/**
 * Parses the diff object stored by transaction.service.ts on EDITED entries.
 *
 * Actual stored shape for most fields: { old: value, new: value }
 * For splitParticipants: { old: [{participantType, participantId, shareAmount}],
 *                          new: [{participantType, participantId, shareAmount}] }
 * (NOT the {added, removed, modified} format described in the spec)
 *
 * Output ordering: amount → currency → description → category → date →
 *   splitMode → notes → participant changes (always last)
 */
export async function formatFieldChanges(
	changesJson: unknown,
	defaultCurrency: string,
	db: PrismaClient,
	nameCache: Map<string, string>,
): Promise<FieldChange[] | null> {
	try {
		if (!changesJson || typeof changesJson !== "object") return null;
		const c = changesJson as Record<string, unknown>;

		// Use the new currency if it changed, otherwise the transaction's currency
		const currencyChange = c.currency as
			| { old: string; new: string }
			| undefined;
		const currency =
			typeof currencyChange === "object" && currencyChange?.new
				? currencyChange.new
				: defaultCurrency;

		const result: FieldChange[] = [];

		// Amount
		const amountChange = c.amount as { old: unknown; new: unknown } | undefined;
		if (amountChange && typeof amountChange === "object") {
			const { old: o, new: n } = amountChange;
			if (o !== undefined && n !== undefined) {
				result.push({
					field: "amount",
					label: "Amount",
					oldValue: safeFormatCurrency(o, currency),
					newValue: safeFormatCurrency(n, currency),
				});
			}
		}

		// Currency (rare but meaningful)
		if (
			currencyChange &&
			typeof currencyChange === "object" &&
			currencyChange.old !== currencyChange.new
		) {
			result.push({
				field: "currency",
				label: "Currency",
				oldValue: String(currencyChange.old ?? ""),
				newValue: String(currencyChange.new ?? ""),
			});
		}

		// Description
		const descChange = c.description as
			| { old: unknown; new: unknown }
			| undefined;
		if (descChange && typeof descChange === "object") {
			const { old: o, new: n } = descChange;
			if (o !== undefined && n !== undefined) {
				result.push({
					field: "description",
					label: "Description",
					oldValue: String(o ?? ""),
					newValue: String(n ?? ""),
				});
			}
		}

		// Category
		const catChange = c.categoryId as
			| { old: unknown; new: unknown }
			| undefined;
		if (catChange && typeof catChange === "object") {
			const { old: oldId, new: newId } = catChange;
			const oldName = oldId
				? ((await resolveCategoryName(db, String(oldId), nameCache)) ??
					String(oldId))
				: "None";
			const newName = newId
				? ((await resolveCategoryName(db, String(newId), nameCache)) ??
					String(newId))
				: "None";
			result.push({
				field: "category",
				label: "Category",
				oldValue: oldName,
				newValue: newName,
			});
		}

		// Date
		const dateChange = c.date as { old: unknown; new: unknown } | undefined;
		if (dateChange && typeof dateChange === "object") {
			const { old: o, new: n } = dateChange;
			if (o !== undefined && n !== undefined) {
				result.push({
					field: "date",
					label: "Date",
					oldValue: o ? formatAuditDate(String(o)) : "-",
					newValue: n ? formatAuditDate(String(n)) : "-",
				});
			}
		}

		// Split mode
		const modeChange = c.splitMode as
			| { old: unknown; new: unknown }
			| undefined;
		if (modeChange && typeof modeChange === "object") {
			const { old: o, new: n } = modeChange;
			if (o !== undefined && n !== undefined) {
				result.push({
					field: "splitMode",
					label: "Split mode",
					oldValue: formatSplitMode(String(o ?? "")),
					newValue: formatSplitMode(String(n ?? "")),
				});
			}
		}

		// Notes
		const notesChange = c.notes as { old: unknown; new: unknown } | undefined;
		if (notesChange && typeof notesChange === "object") {
			const { old: o, new: n } = notesChange;
			result.push({
				field: "notes",
				label: "Notes",
				oldValue: o ? String(o) : "(none)",
				newValue: n ? String(n) : "(none)",
			});
		}

		// Participant changes: derive added/removed/modified by comparing old vs new arrays
		const spChange = c.splitParticipants as
			| {
					old: Array<{
						participantType: string;
						participantId: string;
						shareAmount: number;
					}>;
					new: Array<{
						participantType: string;
						participantId: string;
						shareAmount: number;
					}>;
			  }
			| undefined;

		if (
			spChange &&
			Array.isArray(spChange.old) &&
			Array.isArray(spChange.new)
		) {
			const makeKey = (p: { participantType: string; participantId: string }) =>
				`${p.participantType}:${p.participantId}`;

			const oldMap = new Map(spChange.old.map((p) => [makeKey(p), p]));
			const newMap = new Map(spChange.new.map((p) => [makeKey(p), p]));

			// Added
			for (const [key, p] of newMap) {
				if (!oldMap.has(key)) {
					const name = await resolveActorName(
						db,
						p.participantType,
						p.participantId,
						nameCache,
					);
					result.push({
						field: "participant_added",
						label: `${name} added to split`,
						oldValue: "",
						newValue: `Share: ${safeFormatCurrency(p.shareAmount, currency)}`,
					});
				}
			}

			// Removed
			for (const [key, p] of oldMap) {
				if (!newMap.has(key)) {
					const name = await resolveActorName(
						db,
						p.participantType,
						p.participantId,
						nameCache,
					);
					result.push({
						field: "participant_removed",
						label: `${name} removed from split`,
						oldValue: `Share: ${safeFormatCurrency(p.shareAmount, currency)}`,
						newValue: "",
					});
				}
			}

			// Modified shares
			for (const [key, oldP] of oldMap) {
				const newP = newMap.get(key);
				if (newP && Math.abs(oldP.shareAmount - newP.shareAmount) > 0.001) {
					const name = await resolveActorName(
						db,
						oldP.participantType,
						oldP.participantId,
						nameCache,
					);
					result.push({
						field: "participant_share",
						label: `${name}'s share`,
						oldValue: safeFormatCurrency(oldP.shareAmount, currency),
						newValue: safeFormatCurrency(newP.shareAmount, currency),
					});
				}
			}
		}

		return result.length > 0 ? result : null;
	} catch (err) {
		console.warn("[audit-log] formatFieldChanges failed:", err);
		return null;
	}
}

// ── Summary Generation ────────────────────────────────────────────────────────

const isParticipantField = (f: FieldChange) =>
	["participant_added", "participant_removed", "participant_share"].includes(
		f.field,
	);

/**
 * Generates a one-line human-readable summary for an audit entry.
 * Priority for EDITED: amount > participant changes > description > others.
 * Never throws: falls back to "[Actor] made changes".
 */
export function generateSummary(
	action: string,
	actorName: string,
	fieldChanges: FieldChange[] | null,
	changesJson: unknown,
): string {
	try {
		switch (action) {
			case "CREATED":
				return `${actorName} created this expense`;

			case "DELETED":
				return `${actorName} deleted this expense`;

			case "VERIFIED":
				return `${actorName} verified this expense`;

			case "AUTO_VERIFIED": {
				const c = changesJson as Record<string, unknown> | null;
				const days =
					typeof c?.autoAcceptedAfterDays === "number"
						? c.autoAcceptedAfterDays
						: 7;
				return `Auto-verified after ${days} days of no response`;
			}

			case "REJECTED": {
				const c = changesJson as Record<string, unknown> | null;
				const reason = c?.reason;
				if (reason && typeof reason === "string") {
					const truncated =
						reason.length > 100 ? reason.slice(0, 97) + "…" : reason;
					return `${actorName} disputed this expense: "${truncated}"`;
				}
				return `${actorName} disputed this expense`;
			}

			case "EDITED": {
				if (!fieldChanges || fieldChanges.length === 0) {
					return `${actorName} made changes`;
				}

				const amountChange = fieldChanges.find((f) => f.field === "amount");
				const participantChanges = fieldChanges.filter(isParticipantField);
				const regularChanges = fieldChanges.filter(
					(f) => !isParticipantField(f),
				);

				// Amount has highest priority
				if (amountChange) {
					const otherCount = fieldChanges.length - 1;
					if (otherCount === 0) {
						return `${actorName} changed the amount from ${amountChange.oldValue} to ${amountChange.newValue}`;
					}
					return `${actorName} changed the amount from ${amountChange.oldValue} to ${amountChange.newValue} and made ${otherCount} other change${otherCount === 1 ? "" : "s"}`;
				}

				// Only participant changes
				if (regularChanges.length === 0) {
					if (participantChanges.length === 1) {
						const pc = participantChanges[0]!;
						if (pc.field === "participant_added") {
							const name = pc.label.replace(" added to split", "");
							return `${actorName} added ${name} to the split`;
						}
						if (pc.field === "participant_removed") {
							const name = pc.label.replace(" removed from split", "");
							return `${actorName} removed ${name} from the split`;
						}
					}
					return `${actorName} updated the split`;
				}

				// Single change
				if (fieldChanges.length === 1) {
					const fc = fieldChanges[0]!;
					return `${actorName} changed the ${fc.label.toLowerCase()} from ${fc.oldValue} to ${fc.newValue}`;
				}

				// Two changes
				if (fieldChanges.length === 2) {
					const [f1, f2] = fieldChanges;
					return `${actorName} changed ${f1!.label.toLowerCase()} and ${f2!.label.toLowerCase()}`;
				}

				return `${actorName} made ${fieldChanges.length} changes`;
			}

			default:
				return `${actorName} made changes`;
		}
	} catch {
		return `${actorName} made changes`;
	}
}

// ── Action Metadata ───────────────────────────────────────────────────────────

function getActionMeta(action: string): {
	type: string;
	label: string;
	color: string;
	icon: string;
} {
	const map: Record<
		string,
		{ type: string; label: string; color: string; icon: string }
	> = {
		CREATED: {
			type: "created",
			label: "Created",
			color: "green",
			icon: "plus",
		},
		EDITED: { type: "edited", label: "Edited", color: "amber", icon: "pencil" },
		DELETED: {
			type: "deleted",
			label: "Deleted",
			color: "gray",
			icon: "trash",
		},
		VERIFIED: {
			type: "verified",
			label: "Verified",
			color: "blue",
			icon: "check",
		},
		REJECTED: {
			type: "rejected",
			label: "Disputed",
			color: "red",
			icon: "x-circle",
		},
		AUTO_VERIFIED: {
			type: "auto_verified",
			label: "Auto-verified",
			color: "sky",
			icon: "clock",
		},
		SETTLED: {
			type: "settled",
			label: "Settled",
			color: "blue",
			icon: "check",
		},
		PERIOD_CLOSED: {
			type: "period_closed",
			label: "Period closed",
			color: "gray",
			icon: "lock",
		},
		PARTICIPANT_ADDED: {
			type: "participant_added",
			label: "Participant added",
			color: "green",
			icon: "plus",
		},
		PARTICIPANT_REMOVED: {
			type: "participant_removed",
			label: "Participant removed",
			color: "red",
			icon: "minus",
		},
		ROLE_CHANGED: {
			type: "role_changed",
			label: "Role changed",
			color: "amber",
			icon: "pencil",
		},
	};
	return (
		map[action] ?? {
			type: "unknown",
			label: action,
			color: "gray",
			icon: "circle",
		}
	);
}

// ── Main Entry Formatter ──────────────────────────────────────────────────────

export interface RawAuditEntry {
	id: string;
	timestamp: Date;
	actorType: string;
	actorId: string;
	action: string;
	targetType: string;
	targetId: string;
	changes: unknown;
	context: unknown;
	projectId: string | null;
}

/**
 * Converts a raw AuditLogEntry DB record into a fully formatted TimelineEntry.
 * All fields are resolved to human-readable strings. Never throws.
 */
export async function formatAuditEntry(
	entry: RawAuditEntry,
	defaultCurrency: string,
	db: PrismaClient,
	nameCache: Map<string, string>,
): Promise<TimelineEntry> {
	const actorName = await resolveActorName(
		db,
		entry.actorType,
		entry.actorId,
		nameCache,
	);
	const actionMeta = getActionMeta(entry.action);

	let detail: TimelineDetail | null = null;
	let fieldChanges: FieldChange[] | null = null;

	try {
		switch (entry.action) {
			case "CREATED": {
				const snapshot = await buildCreationSnapshot(
					entry.changes,
					db,
					nameCache,
				);
				if (snapshot) detail = { type: "creation_snapshot", snapshot };
				break;
			}
			case "DELETED": {
				const snapshot = await buildCreationSnapshot(
					entry.changes,
					db,
					nameCache,
				);
				if (snapshot) detail = { type: "deletion_snapshot", snapshot };
				break;
			}
			case "EDITED": {
				fieldChanges = await formatFieldChanges(
					entry.changes,
					defaultCurrency,
					db,
					nameCache,
				);
				if (fieldChanges?.length) {
					detail = { type: "field_changes", changes: fieldChanges };
				}
				break;
			}
			case "REJECTED": {
				const c = entry.changes as Record<string, unknown> | null;
				const reason = typeof c?.reason === "string" ? c.reason : null;
				if (reason) detail = { type: "rejection", reason };
				break;
			}
			case "VERIFIED":
			case "AUTO_VERIFIED":
				// Summary is sufficient; no detail section needed
				break;
		}
	} catch (err) {
		console.warn(
			`[audit-log] Error formatting detail for entry ${entry.id}:`,
			err,
		);
	}

	const summary = generateSummary(
		entry.action,
		actorName,
		fieldChanges,
		entry.changes,
	);

	const actorDisplayType: "user" | "guest" | "system" | "unknown" =
		entry.actorId === SYSTEM_SENTINEL
			? "system"
			: entry.actorType === "user"
				? "user"
				: entry.actorType === "guest"
					? "guest"
					: "unknown";

	return {
		id: entry.id,
		timestamp: entry.timestamp.toISOString(),
		relativeTime: formatRelativeTime(entry.timestamp),
		actor: {
			name: actorName,
			type: actorDisplayType,
			id: entry.actorId === SYSTEM_SENTINEL ? null : entry.actorId,
		},
		action: actionMeta,
		summary,
		detail,
	};
}
