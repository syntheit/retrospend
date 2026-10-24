/**
 * Recurring templates as a service (create, update, delete, extras), so
 * /api/v1 does not carry the logic. Mirrors what routers/recurring.ts does
 * inline; the tRPC router can call these when it is next touched. Confirming
 * a due template is a money write: see recurring-confirm.mutation.ts.
 */
import { parseDateOnlyIn } from "@retrospend/domain/time-zone";
import { TRPCError } from "@trpc/server";
import type {
	ExpenseDirection,
	Prisma,
	PrismaClient,
	RecurringAmountMode,
	RecurringFrequency,
} from "~prisma";

type Db = PrismaClient | Prisma.TransactionClient;

export interface NewTemplate {
	readonly name: string;
	readonly amount: string;
	readonly currency: string;
	readonly categoryId?: string;
	readonly frequency: RecurringFrequency;
	/** YYYY-MM-DD, the first due day in the caller's zone. */
	readonly nextDueDate: string;
	readonly direction?: ExpenseDirection;
	readonly amountMode?: RecurringAmountMode;
	readonly websiteUrl?: string;
	readonly paymentSource?: string;
	readonly autoPay?: boolean;
}

export interface TemplateChanges {
	readonly name?: string;
	readonly amount?: string;
	readonly currency?: string;
	readonly categoryId?: string | null;
	readonly frequency?: RecurringFrequency;
	readonly nextDueDate?: string;
	readonly amountMode?: RecurringAmountMode;
	readonly websiteUrl?: string | null;
	readonly paymentSource?: string | null;
	readonly autoPay?: boolean;
	readonly isActive?: boolean;
}

async function refuseForeignCategory(
	db: Db,
	userId: string,
	categoryId: string | null | undefined,
	direction: ExpenseDirection,
) {
	if (!categoryId) return;
	const category = await db.category.findFirst({
		where: {
			id: categoryId,
			userId,
			kind: direction === "IN" ? "INCOME" : "EXPENSE",
		},
		select: { id: true },
	});
	if (!category)
		throw new TRPCError({ code: "FORBIDDEN", message: "Category not found" });
}

/** The day of month a schedule is anchored to, read off the typed day. */
const anchorOf = (day: string) => Number(day.slice(8, 10));

export async function createTemplate(
	db: Db,
	userId: string,
	input: NewTemplate,
	timeZone?: string,
) {
	const direction = input.direction ?? "OUT";
	await refuseForeignCategory(db, userId, input.categoryId, direction);
	return db.recurringTemplate.create({
		data: {
			userId,
			name: input.name,
			amount: input.amount,
			currency: input.currency,
			categoryId: input.categoryId,
			direction,
			amountMode: input.amountMode ?? "FIXED",
			frequency: input.frequency,
			nextDueDate: parseDateOnlyIn(input.nextDueDate, timeZone),
			anchorDay: anchorOf(input.nextDueDate),
			websiteUrl: input.websiteUrl,
			paymentSource: input.paymentSource,
			autoPay: input.autoPay ?? true,
		},
		select: { id: true },
	});
}

export async function updateTemplate(
	db: Db,
	userId: string,
	id: string,
	changes: TemplateChanges,
	timeZone?: string,
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
	await db.recurringTemplate.update({
		where: { id },
		data: {
			name: changes.name,
			amount: changes.amount,
			currency: changes.currency,
			categoryId: changes.categoryId,
			amountMode: changes.amountMode,
			frequency: changes.frequency,
			// A due date the user sets is the new anchor for monthly steps.
			...(changes.nextDueDate && {
				nextDueDate: parseDateOnlyIn(changes.nextDueDate, timeZone),
				anchorDay: anchorOf(changes.nextDueDate),
			}),
			websiteUrl: changes.websiteUrl,
			paymentSource: changes.paymentSource,
			autoPay: changes.autoPay,
			isActive: changes.isActive,
		},
	});
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
