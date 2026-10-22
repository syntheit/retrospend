/**
 * Creating, editing and deleting a project. Each write and its audit entry
 * commit together in one RLS transaction.
 */
import { TRPCError } from "@trpc/server";
import { computePeriodLabel } from "~/server/api/routers/billingPeriod";
import { userTransaction } from "~/server/db-tx";
import { logAudit } from "~/server/services/shared-expenses/audit-log";
import type { Prisma, PrismaClient } from "~prisma";
import type { ProjectActor } from "./types";

type CycleLength = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "CUSTOM";

function billingPeriodEnd(
	start: Date,
	cycleLength: CycleLength,
	cycleDays?: number | null,
): Date {
	const end = new Date(start);
	switch (cycleLength) {
		case "WEEKLY":
			end.setDate(end.getDate() + 7);
			break;
		case "BIWEEKLY":
			end.setDate(end.getDate() + 14);
			break;
		case "MONTHLY":
			end.setMonth(end.getMonth() + 1);
			break;
		case "CUSTOM":
			end.setDate(end.getDate() + (cycleDays ?? 30));
			break;
	}
	return end;
}

/** Opens a project's first billing period, starting now. */
function openFirstPeriod(
	tx: Prisma.TransactionClient,
	projectId: string,
	cycleLength: CycleLength,
	cycleDays?: number | null,
) {
	const startDate = new Date();
	const endDate = billingPeriodEnd(startDate, cycleLength, cycleDays);
	return tx.billingPeriod.create({
		data: {
			projectId,
			label: computePeriodLabel(startDate, endDate, cycleLength),
			startDate,
			endDate,
			status: "OPEN",
		},
	});
}

export interface CreateProjectInput {
	name: string;
	description?: string;
	budgetAmount?: number;
	budgetCurrency?: string;
	primaryCurrency: string;
	visibility: "PRIVATE" | "PUBLIC";
	billingCycleLength?: CycleLength;
	billingCycleDays?: number;
	billingAutoClose: boolean;
	billingCloseReminderDays: number;
	billingClosePermission: "ORGANIZER_ONLY" | "ANY_PARTICIPANT";
}

export async function createProject(
	db: PrismaClient,
	{ userId }: ProjectActor,
	input: CreateProjectInput,
) {
	const project = await userTransaction(db, userId, async (tx) => {
		const created = await tx.project.create({
			data: {
				name: input.name,
				description: input.description ?? null,
				budgetAmount: input.budgetAmount ?? null,
				budgetCurrency: input.budgetCurrency ?? null,
				primaryCurrency: input.primaryCurrency,
				createdById: userId,
				visibility: input.visibility,
				billingCycleLength: input.billingCycleLength ?? null,
				billingCycleDays: input.billingCycleDays ?? null,
				billingAutoClose: input.billingAutoClose,
				billingCloseReminderDays: input.billingCloseReminderDays,
				billingClosePermission: input.billingClosePermission,
			},
		});
		// The creator is always the owner.
		await tx.projectParticipant.create({
			data: {
				projectId: created.id,
				participantType: "user",
				participantId: userId,
				role: "ORGANIZER",
			},
		});
		if (input.billingCycleLength) {
			await openFirstPeriod(
				tx,
				created.id,
				input.billingCycleLength,
				input.billingCycleDays,
			);
		}
		await logAudit(tx, {
			actor: { participantType: "user", participantId: userId },
			action: "CREATED",
			targetType: "PROJECT",
			targetId: created.id,
			changes: { name: input.name },
			projectId: created.id,
		});
		return created;
	});

	return db.project.findUniqueOrThrow({
		where: { id: project.id },
		include: { participants: true, billingPeriods: true },
	});
}

export interface UpdateProjectInput {
	name?: string;
	description?: string | null;
	budgetAmount?: number | null;
	budgetCurrency?: string | null;
	primaryCurrency?: string;
	status?: "ACTIVE" | "ARCHIVED";
	visibility?: "PRIVATE" | "PUBLIC";
	billingCycleLength?: CycleLength | null;
	billingCycleDays?: number | null;
	billingAutoClose?: boolean;
	billingCloseReminderDays?: number;
	billingClosePermission?: "ORGANIZER_ONLY" | "ANY_PARTICIPANT";
	autoAcceptSplits?: boolean;
}

const TRACKED: readonly (keyof UpdateProjectInput)[] = [
	"name",
	"description",
	"budgetAmount",
	"budgetCurrency",
	"primaryCurrency",
	"status",
	"visibility",
	"billingCycleLength",
	"billingCycleDays",
	"billingAutoClose",
	"billingCloseReminderDays",
	"billingClosePermission",
	"autoAcceptSplits",
];

/** Caller must be an editor. Writes and audits only the fields that changed. */
export async function updateProject(
	db: PrismaClient,
	{ userId }: ProjectActor,
	id: string,
	fields: UpdateProjectInput,
) {
	const existing = await db.project.findUniqueOrThrow({ where: { id } });

	const diff: Record<string, { old: unknown; new: unknown }> = {};
	const updateData: Record<string, unknown> = {};
	for (const key of TRACKED) {
		const oldVal = (existing as Record<string, unknown>)[key];
		const newVal = fields[key];
		if (newVal !== undefined && newVal !== oldVal) {
			diff[key] = { old: oldVal, new: newVal };
			updateData[key] = newVal;
		}
	}
	if (Object.keys(diff).length === 0) return existing;

	// Turning billing periods on opens a first period, as creating a project
	// does, unless one is already open (re-enabling reuses a leftover one).
	const enablingBilling =
		existing.billingCycleLength == null && fields.billingCycleLength != null;

	return userTransaction(db, userId, async (tx) => {
		const updated = await tx.project.update({
			where: { id },
			data: updateData as Prisma.ProjectUncheckedUpdateInput,
		});
		if (enablingBilling && fields.billingCycleLength) {
			const open = await tx.billingPeriod.findFirst({
				where: { projectId: id, status: "OPEN" },
				select: { id: true },
			});
			if (!open) {
				await openFirstPeriod(
					tx,
					id,
					fields.billingCycleLength,
					fields.billingCycleDays ?? undefined,
				);
			}
		}
		await logAudit(tx, {
			actor: { participantType: "user", participantId: userId },
			action: "EDITED",
			targetType: "PROJECT",
			targetId: id,
			changes: diff as Prisma.InputJsonValue,
			projectId: id,
		});
		return updated;
	});
}

/** Caller must be an owner; only the creator may delete. */
export async function deleteProject(
	db: PrismaClient,
	{ userId }: ProjectActor,
	id: string,
) {
	const project = await db.project.findUniqueOrThrow({
		where: { id },
		select: { createdById: true, name: true },
	});
	if (project.createdById !== userId) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Only the project creator can delete a project",
		});
	}
	return userTransaction(db, userId, async (tx) => {
		await logAudit(tx, {
			actor: { participantType: "user", participantId: userId },
			action: "DELETED",
			targetType: "PROJECT",
			targetId: id,
			changes: { name: project.name },
			projectId: id,
		});
		await tx.project.delete({ where: { id } });
		return { success: true };
	});
}

/** The caller's own "leave this project out of my analytics" switch. */
export async function setAnalyticsExclusion(
	db: PrismaClient,
	{ userId }: ProjectActor,
	projectId: string,
	exclude: boolean,
) {
	const updated = await db.projectParticipant.updateMany({
		where: { projectId, participantType: "user", participantId: userId },
		data: { excludeFromAnalytics: exclude },
	});
	if (updated.count === 0) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "You are not a participant in this project",
		});
	}
	return { excludeFromAnalytics: exclude };
}
