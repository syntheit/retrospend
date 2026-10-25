import {
	type AdminAiSettingsDto,
	type AdminSettingsDto,
	backupStartedSchema,
	backupStatusSchema,
	type CursorQuery,
} from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import * as z from "zod";
import { db } from "~/server/db";
import { ImportQueueService } from "~/server/services/import-queue.service";
import type { AuditPrivacyMode } from "~prisma";
import { isoDay } from "./caller";
import {
	decodeCursor,
	encodeCursor,
	InvalidCursorError,
	toPage,
} from "./cursor";
import type { LedgerCaller } from "./money-op";
import { trpcAdmin } from "./trpc-bridge";

/**
 * v1 adapters for /admin. The procedures behind them are the web admin's
 * (the admin tRPC router, called in-process), so audit events and the
 * self-protection rules (no disabling or deleting yourself) are the same.
 * Nothing here reads another user's titles or notes; event log metadata is
 * filtered for them as well (see stripUserText).
 */

/** The scope already demands `admin`; this checks the role itself again. */
export function assertAdmin(caller: LedgerCaller) {
	if (caller.principal.role !== "ADMIN")
		throw new TRPCError({ code: "FORBIDDEN", message: "Admins only" });
}

async function admin(caller: LedgerCaller) {
	assertAdmin(caller);
	return trpcAdmin(caller);
}

async function requireUser(id: string) {
	const found = await db.user.findUnique({
		where: { id },
		select: { id: true },
	});
	if (!found)
		throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
}

const ok = { ok: true as const };
const idKey = z.object({ id: z.string() });

export async function stats(caller: LedgerCaller) {
	const t = await admin(caller);
	const [counts, server, importQueue] = await Promise.all([
		t.getStats(),
		t.getServerStats(),
		new ImportQueueService(db).getGlobalStats(),
	]);
	return {
		importQueue,
		userCount: counts.userCount,
		databaseSizeBytes: server.databaseSize,
		storageSizeBytes: server.storageSize,
		uptimeSeconds: Math.floor(server.uptime),
	};
}

// ── users ───────────────────────────────────────────────────────────────

export async function listUsers(caller: LedgerCaller, q: CursorQuery) {
	const t = await admin(caller);
	const all = await t.listUsers();
	const after = decodeCursor(q.cursor, idKey);
	let start = 0;
	if (after) {
		const at = all.findIndex((u) => u.id === after.id);
		if (at < 0) throw new InvalidCursorError();
		start = at + 1;
	}
	return toPage(
		all.slice(start, start + q.limit + 1),
		q.limit,
		(u) => ({ id: u.id }),
		(u) => ({
			id: u.id,
			username: u.username,
			email: u.email,
			emailVerified: u.emailVerified,
			twoFactorEnabled: u.twoFactorEnabled,
			role: u.role,
			isActive: u.isActive,
			createdAt: u.createdAt.toISOString(),
			expenseCount: u.expenseCount,
			inviteCodesCount: u.inviteCodesCount,
			lastExpenseDate: u.lastExpenseDate ? isoDay(u.lastExpenseDate) : null,
			hasBudget: u.hasBudget,
			hasRecurring: u.hasRecurring,
			hasWealth: u.hasWealth,
			externalAiAllowed: u.externalAiAllowed,
		}),
	);
}

export async function setActive(
	caller: LedgerCaller,
	id: string,
	active: boolean,
) {
	const t = await admin(caller);
	await requireUser(id);
	if (active) await t.enableUser({ userId: id });
	else await t.disableUser({ userId: id });
	return ok;
}

export async function setEmailVerified(
	caller: LedgerCaller,
	input: { id: string; verified: boolean },
) {
	const t = await admin(caller);
	await requireUser(input.id);
	await t.toggleEmailVerification({
		userId: input.id,
		verified: input.verified,
	});
	return ok;
}

export async function setAiAccess(
	caller: LedgerCaller,
	input: { id: string; allowed: boolean | null },
) {
	const t = await admin(caller);
	await requireUser(input.id);
	await t.setUserAiAccess({
		userId: input.id,
		externalAiAllowed: input.allowed,
	});
	return ok;
}

export async function removeAvatar(caller: LedgerCaller, id: string) {
	const t = await admin(caller);
	await t.removeUserAvatar({ userId: id });
	return ok;
}

export async function deleteUser(caller: LedgerCaller, id: string) {
	const t = await admin(caller);
	await requireUser(id);
	await t.deleteUser({ userId: id });
	return ok;
}

// ── settings ────────────────────────────────────────────────────────────

type Settings = AdminSettingsDto;
type AiSettings = AdminAiSettingsDto;

const MODES: Record<AuditPrivacyMode, Settings["auditPrivacyMode"]> = {
	MINIMAL: "minimal",
	ANONYMIZED: "anonymized",
	FULL: "full",
};

const toMode = (m: Settings["auditPrivacyMode"]): AuditPrivacyMode =>
	m.toUpperCase() as AuditPrivacyMode;

export async function getSettings(caller: LedgerCaller): Promise<Settings> {
	const t = await admin(caller);
	const s = await t.getSettings();
	return { ...s, auditPrivacyMode: MODES[s.auditPrivacyMode] };
}

export async function updateSettings(
	caller: LedgerCaller,
	input: Partial<Settings>,
): Promise<Settings> {
	const t = await admin(caller);
	const { auditPrivacyMode, ...rest } = input;
	const s = await t.updateSettings({
		...rest,
		...(auditPrivacyMode ? { auditPrivacyMode: toMode(auditPrivacyMode) } : {}),
	});
	return { ...s, auditPrivacyMode: MODES[s.auditPrivacyMode] };
}

export async function getAiSettings(caller: LedgerCaller): Promise<AiSettings> {
	return (await admin(caller)).getAiSettings();
}

export async function updateAiSettings(
	caller: LedgerCaller,
	input: Parameters<
		Awaited<ReturnType<typeof trpcAdmin>>["updateAiSettings"]
	>[0],
): Promise<AiSettings> {
	const t = await admin(caller);
	await t.updateAiSettings(input);
	return t.getAiSettings();
}

export async function aiUsage(
	caller: LedgerCaller,
	input: { yearMonth?: string },
) {
	return (await admin(caller)).getAiUsageStats(input);
}

// ── event logs ──────────────────────────────────────────────────────────

const TEXTY_KEY = /title|note|description|memo|merchant|comment/i;

/**
 * Event metadata is ids, flags and account names today. A key that looks
 * like user text (a title, note or description) is dropped at any depth, so
 * a future event that adds one cannot leak it to an admin.
 */
export function stripUserText(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stripUserText);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([key]) => !TEXTY_KEY.test(key))
				.map(([key, v]) => [key, stripUserText(v)]),
		);
	}
	return value;
}

const logCursor = z.object({ before: z.iso.datetime() });

type LogType = Parameters<
	Awaited<ReturnType<typeof trpcAdmin>>["getEventLogsCursor"]
>[0]["eventType"];

export async function eventLogs(
	caller: LedgerCaller,
	q: { cursor?: string; limit: number; eventType?: LogType },
) {
	const t = await admin(caller);
	const after = decodeCursor(q.cursor, logCursor);
	const page = await t.getEventLogsCursor({
		limit: q.limit,
		eventType: q.eventType,
		cursor: after?.before,
	});
	return {
		items: page.logs.map((l) => ({
			id: l.id,
			timestamp: l.timestamp.toISOString(),
			eventType: l.eventType,
			user: l.user
				? { id: l.user.id, username: l.user.username, email: l.user.email }
				: null,
			ipAddress: l.ipAddress,
			userAgent: l.userAgent,
			metadata:
				l.metadata &&
				typeof l.metadata === "object" &&
				!Array.isArray(l.metadata)
					? (stripUserText(l.metadata) as Record<string, unknown>)
					: null,
		})),
		nextCursor: page.nextCursor
			? encodeCursor({ before: page.nextCursor })
			: null,
	};
}

// ── backups ─────────────────────────────────────────────────────────────

export async function backupStatus(caller: LedgerCaller) {
	const raw = await (await admin(caller)).getBackupStatus();
	const parsed = backupStatusSchema.safeParse(raw);
	return parsed.success ? parsed.data : { available: false };
}

export async function startBackup(caller: LedgerCaller) {
	const t = await admin(caller);
	try {
		return backupStartedSchema.parse(await t.triggerBackup());
	} catch (error) {
		if (error instanceof Error && /already in progress|409/.test(error.message))
			throw new TRPCError({
				code: "CONFLICT",
				message: "A backup is already running",
			});
		throw error;
	}
}
