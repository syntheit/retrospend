/**
 * Recurring templates as a service (create, update, delete, extras), so
 * /api/v1 and the web's tRPC router share one write. Both keep a picked due
 * day at the start of that day in the user's saved zone. Confirming a due
 * template is a money write: see recurring-confirm.mutation.ts.
 */
import {
	RECURRING_CHANGED,
	RECURRING_NOT_FOUND,
	RecurringRefusal,
} from "@retrospend/domain/recurring-post/refusals";
import {
	checkTemplateCategory,
	editPatch,
	newTemplateDirection,
	newTemplateRow,
	type TemplateDirection,
	type TemplateEdit,
	type TemplateInput,
} from "@retrospend/domain/recurring-post/template";
import { TRPCError } from "@trpc/server";
import { userTimeZone } from "~/server/services/user-time-zone";
import type { Prisma, PrismaClient } from "~prisma";
import { asBadRequest } from "./rate-types";

type Db = PrismaClient | Prisma.TransactionClient;

export interface NewTemplate extends TemplateInput {
	/** A client-made id; a taken one is a unique violation (id_taken), not a second template. */
	readonly id?: string;
}

export interface TemplateChanges extends TemplateEdit {
	/** The updatedAt the caller read; the write runs only while the template still has it. */
	readonly expectedUpdatedAt?: Date;
}

async function refuseForeignCategory(
	db: Db,
	userId: string,
	categoryId: string | null | undefined,
	direction: TemplateDirection,
) {
	if (!categoryId) return;
	const found = await db.category.findFirst({
		where: { id: categoryId, userId },
		select: { kind: true },
	});
	checkTemplateCategory(found, direction);
}

export async function createTemplate(
	db: Db,
	userId: string,
	input: NewTemplate,
) {
	await refuseForeignCategory(
		db,
		userId,
		input.categoryId,
		newTemplateDirection(input),
	);
	const zone = await userTimeZone(db, userId);
	const row = asBadRequest(() => newTemplateRow(input, zone));
	return db.recurringTemplate.create({
		data: { id: input.id, userId, ...row },
		select: { id: true },
	});
}

export async function updateTemplate(
	db: Db,
	userId: string,
	id: string,
	changes: TemplateChanges,
) {
	const existing = await db.recurringTemplate.findFirst({
		where: { id, userId },
		select: { direction: true },
	});
	if (!existing)
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Recurring template not found",
		});
	await refuseForeignCategory(
		db,
		userId,
		changes.categoryId,
		existing.direction,
	);
	const patch = editPatch(
		changes,
		existing.direction,
		await userTimeZone(db, userId),
	);
	// With a stamp the write is a compare-and-set on updatedAt: two edits that
	// read the same version cannot both land. It is an `update` (not an
	// `updateMany`) so a sealed name is bound to this row's id.
	try {
		await db.recurringTemplate.update({
			where: {
				id,
				...(changes.expectedUpdatedAt && {
					updatedAt: changes.expectedUpdatedAt,
				}),
			},
			data: patch,
		});
	} catch (error) {
		if (
			!changes.expectedUpdatedAt ||
			(error as { code?: string }).code !== "P2025"
		)
			throw error;
		// No row matched: the template is gone, or it no longer has the stamp.
		const stillThere = await db.recurringTemplate.count({
			where: { id, userId },
		});
		throw stillThere
			? new RecurringRefusal("changed", RECURRING_CHANGED)
			: new RecurringRefusal("not_found", RECURRING_NOT_FOUND);
	}
}

export async function deleteTemplate(db: Db, userId: string, id: string) {
	const result = await db.recurringTemplate.deleteMany({
		where: { id, userId },
	});
	if (result.count === 0)
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Recurring template not found",
		});
}

/** What the Recurring tab's view does not carry, by template id. */
export async function templateExtras(db: Db, userId: string) {
	const rows = await db.recurringTemplate.findMany({
		where: { userId },
		select: {
			id: true,
			websiteUrl: true,
			paymentSource: true,
			updatedAt: true,
		},
	});
	return new Map(rows.map((r) => [r.id, r]));
}

/** The template's due instant now (after a confirm moved it). */
export async function templateDueAt(db: Db, userId: string, id: string) {
	const row = await db.recurringTemplate.findFirst({
		where: { id, userId },
		select: { nextDueDate: true },
	});
	return row?.nextDueDate ?? null;
}

/** Whether a template exists for this user, and which way its money goes. */
export async function templateDirection(db: Db, userId: string, id: string) {
	const row = await db.recurringTemplate.findFirst({
		where: { id, userId },
		select: { direction: true },
	});
	if (!row)
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Recurring template not found",
		});
	return row.direction;
}
