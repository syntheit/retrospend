import type {
	addMemberSchema,
	createMagicLinkSchema,
	createProjectSchema,
	memberDatesSchema,
	memberParamsSchema,
	memberRoleSchema,
	resetMagicLinkSchema,
	transferOwnershipSchema,
	updateProjectSchema,
} from "@retrospend/api-contract";
import { encodeCursor, decodeCursor } from "./cursor";
import * as z from "zod";
import { toMinor } from "~/server/services/envelope/units";
import { inviteUrl } from "~/server/services/project/magic-links.service";
import { previewMembershipDates } from "~/server/services/project/membership.service";
import { listProjectExpenses } from "~/server/services/project/expenses.service";
import { requireProjectRole } from "~/server/services/shared-expenses/project-permissions";
import type { Caller } from "./caller";
import { isoDay } from "./caller";
import { exactAmount } from "./amounts";
import type { LedgerCaller } from "./money-op";
import { toPreviewDto } from "./money-write";
import { trpcProject } from "./trpc-bridge";

/**
 * v1 adapters for the project writes. The logic stays where the web has it:
 * the project router's procedures run in-process (the same role checks,
 * audit entries and notices), the rebalance runs as the money mutation the
 * preview rolls back. Amounts come in as decimal text and reach the services
 * as the number they take today.
 */

type Body<S extends z.ZodType> = z.infer<S>;
type Role = "ORGANIZER" | "EDITOR" | "CONTRIBUTOR" | "VIEWER";
type Kind = "user" | "guest" | "shadow";
type SplitMode = "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";

const bridge = (caller: LedgerCaller) => trpcProject(caller);

// ── The project ─────────────────────────────────────────────────────────────

type SettingsRow = {
	id: string;
	name: string;
	description: string | null;
	status: "ACTIVE" | "ARCHIVED";
	visibility: "PRIVATE" | "PUBLIC";
	primaryCurrency: string;
	budgetAmount: { toString(): string } | null;
	budgetCurrency: string | null;
	billingCycleLength: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "CUSTOM" | null;
	billingCycleDays: number | null;
	billingAutoClose: boolean;
	billingCloseReminderDays: number;
	billingClosePermission: "ORGANIZER_ONLY" | "ANY_PARTICIPANT";
	autoAcceptSplits: boolean;
	createdAt: Date;
	updatedAt: Date;
};

function settingsOf(row: SettingsRow) {
	const currency = row.budgetCurrency ?? row.primaryCurrency;
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		status: row.status,
		visibility: row.visibility,
		primaryCurrency: row.primaryCurrency,
		budget:
			row.budgetAmount === null
				? null
				: { minor: toMinor(row.budgetAmount.toString(), currency), currency },
		billingCycleLength: row.billingCycleLength,
		billingCycleDays: row.billingCycleDays,
		billingAutoClose: row.billingAutoClose,
		billingCloseReminderDays: row.billingCloseReminderDays,
		billingClosePermission: row.billingClosePermission,
		autoAcceptSplits: row.autoAcceptSplits,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/** A budget as the number the project services take; left out stays undefined. */
const budgetOf = (text: string | null | undefined, currency: string) =>
	text === null || text === undefined
		? text
		: exactAmount(text, currency, "budgetAmount");

export async function createProject(
	caller: LedgerCaller,
	body: Body<typeof createProjectSchema>,
) {
	const currency = body.budgetCurrency ?? body.primaryCurrency;
	const row = await (await bridge(caller)).create({
		...body,
		budgetAmount: budgetOf(body.budgetAmount, currency) ?? undefined,
	});
	return settingsOf(row);
}

export async function updateProject(
	caller: LedgerCaller,
	body: Body<typeof updateProjectSchema>,
) {
	const currency = body.budgetCurrency ?? body.primaryCurrency ?? "USD";
	const row = await (await bridge(caller)).update({
		...body,
		budgetAmount: budgetOf(body.budgetAmount, currency),
	});
	return settingsOf(row);
}

export async function setAnalyticsExclusion(
	caller: LedgerCaller,
	id: string,
	exclude: boolean,
) {
	await (await bridge(caller)).updateAnalyticsExclusion({
		projectId: id,
		exclude,
	});
	return { exclude };
}

// ── Members ─────────────────────────────────────────────────────────────────

type MemberLike = {
	participantType: Kind;
	participantId: string;
	role: Role;
	joinedOn: Date | string | null;
	leftOn: Date | string | null;
};

const dayOf = (d: Date | string | null) =>
	d === null ? null : typeof d === "string" ? d : isoDay(d);

const memberRow = (m: MemberLike) => ({
	person: { type: m.participantType, id: m.participantId },
	role: m.role,
	joinedOn: dayOf(m.joinedOn),
	leftOn: dayOf(m.leftOn),
});

export async function addMember(
	caller: LedgerCaller,
	body: Body<typeof addMemberSchema>,
) {
	const row = await (await bridge(caller)).addParticipant({
		projectId: body.id,
		participantType: body.person.type,
		participantId: body.person.id,
		role: body.role,
		joinedOn: body.joinedOn,
	});
	return memberRow(row);
}

export async function setMemberRole(
	caller: LedgerCaller,
	body: Body<typeof memberRoleSchema>,
) {
	const row = await (await bridge(caller)).updateParticipantRole({
		projectId: body.id,
		participantType: body.type,
		participantId: body.personId,
		role: body.role,
	});
	return memberRow(row);
}

const datesInput = (body: Body<typeof memberDatesSchema>) => ({
	projectId: body.id,
	participantType: body.type,
	participantId: body.personId,
	joinedOn: body.joinedOn,
	leftOn: body.leftOn,
});

export async function setMemberDates(
	caller: LedgerCaller,
	body: Body<typeof memberDatesSchema>,
) {
	return memberRow(
		await (await bridge(caller)).setMembershipDates(datesInput(body)),
	);
}

export async function previewMemberDates(
	caller: LedgerCaller,
	body: Body<typeof memberDatesSchema>,
) {
	const me = await requireProjectRole(
		caller.db,
		body.id,
		"user",
		caller.principal.userId,
		"EDITOR",
	);
	return toPreviewDto(
		await previewMembershipDates(
			caller.principal.userId,
			me.role,
			datesInput(body),
		),
	);
}

export async function removeMember(
	caller: LedgerCaller,
	body: Body<typeof memberParamsSchema>,
) {
	await (await bridge(caller)).removeParticipant({
		projectId: body.id,
		participantType: body.type,
		participantId: body.personId,
	});
	return { ok: true as const };
}

export async function transferOwnership(
	caller: LedgerCaller,
	body: Body<typeof transferOwnershipSchema>,
) {
	await (await bridge(caller)).transferOwnership({
		projectId: body.id,
		newOwnerParticipantId: body.newOwnerId,
		confirmProjectName: body.confirmProjectName,
	});
	return { ok: true as const };
}

// ── Magic links ─────────────────────────────────────────────────────────────

type LinkRow = {
	id: string;
	projectId: string;
	roleGranted: Role;
	isActive: boolean;
	expiresAt: Date | null;
	maxUses: number | null;
	useCount: number;
	createdAt: Date;
};

const linkOf = (l: LinkRow) => ({
	id: l.id,
	roleGranted: l.roleGranted,
	url: inviteUrl(l.projectId, l.id),
	isActive: l.isActive,
	expiresAt: l.expiresAt?.toISOString() ?? null,
	maxUses: l.maxUses,
	useCount: l.useCount,
	createdAt: l.createdAt.toISOString(),
});

export async function listMagicLinks(caller: LedgerCaller, id: string) {
	const rows = await (await bridge(caller)).listMagicLinks({ projectId: id });
	return { items: rows.map(linkOf) };
}

export async function createMagicLink(
	caller: LedgerCaller,
	body: Body<typeof createMagicLinkSchema>,
) {
	return linkOf(
		await (await bridge(caller)).createMagicLink({
			projectId: body.id,
			roleGranted: body.roleGranted,
			expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
			maxUses: body.maxUses,
		}),
	);
}

export async function revokeMagicLink(
	caller: LedgerCaller,
	id: string,
	linkId: string,
) {
	await (await bridge(caller)).revokeMagicLink({ projectId: id, linkId });
	return { ok: true as const };
}

export async function resetMagicLink(
	caller: LedgerCaller,
	body: Body<typeof resetMagicLinkSchema>,
) {
	return linkOf(
		await (await bridge(caller)).resetMagicLink({
			projectId: body.id,
			role: body.role,
		}),
	);
}

// ── Expenses of a project ───────────────────────────────────────────────────

const pageKey = z.object({ page: z.int().min(1) });

export async function listExpenses(
	caller: Caller,
	query: {
		id: string;
		billingPeriodId?: string;
		cursor?: string;
		limit: number;
	},
) {
	const member = await requireProjectRole(
		caller.db,
		query.id,
		"user",
		caller.principal.userId,
		"VIEWER",
	);
	const page = decodeCursor(query.cursor, pageKey)?.page ?? 1;
	const viewer = {
		participantType: "user" as const,
		participantId: caller.principal.userId,
	};
	const out = await listProjectExpenses(
		caller.db,
		{
			projectId: query.id,
			billingPeriodId: query.billingPeriodId,
			page,
			limit: query.limit,
		},
		viewer,
		member.role as Role,
	);
	const money = (amount: number | { toString(): string }, currency: string) => ({
		minor: toMinor(String(amount), currency),
		currency,
	});
	return {
		items: out.transactions.map((t) => ({
			id: t.id,
			title: t.description,
			date: isoDay(t.date),
			amount: money(t.amount, t.currency),
			category: t.category,
			splitMode: t.splitMode as SplitMode,
			locked: t.isLocked,
			status: t.status as "pending" | "disputed" | "active" | "settled",
			paidBy: {
				type: t.paidBy.type as Kind,
				id: t.paidBy.id,
				name: t.paidBy.name,
				imageUrl: t.paidBy.avatarUrl,
				isMe: t.paidBy.isMe,
			},
			canEdit: t.canEdit,
			hasUnseenChanges: t.hasUnseenChanges,
			splits: t.splitParticipants.map((sp) => ({
				type: sp.participantType as Kind,
				id: sp.participantId,
				name: sp.name,
				imageUrl: sp.avatarUrl,
				share: money(sp.shareAmount, t.currency),
				verification: sp.verificationStatus,
			})),
		})),
		nextCursor:
			page * query.limit < out.total ? encodeCursor({ page: page + 1 }) : null,
		total: out.total,
	};
}
