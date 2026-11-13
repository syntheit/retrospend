import { convertDec } from "@retrospend/domain/money-dec";
import { dec, toFloat } from "@retrospend/domain/precise-decimal";
import { dayKey, startOfNextDayIn } from "@retrospend/domain/time-zone";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	createRecurringInput,
	updateRecurringInput,
} from "~/lib/schemas/recurring";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { userTransaction } from "~/server/db-tx";
import { RateCache } from "~/server/services/rate-cache";
import {
	createTemplate,
	updateTemplate,
} from "~/server/services/recurring.service";
import { confirmRecurringExpense } from "~/server/services/recurring-confirm.mutation";

export const recurringRouter = createTRPCRouter({
	list: protectedProcedure
		.input(
			z
				.object({
					includeInactive: z.boolean().optional(),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const templates = await db.recurringTemplate.findMany({
				where: {
					userId: session.user.id,
					...(input?.includeInactive ? {} : { isActive: true }),
				},
				orderBy: {
					nextDueDate: "asc",
				},
				include: {
					category: {
						select: {
							id: true,
							name: true,
							color: true,
						},
					},
				},
			});

			const user = await db.user.findUnique({
				where: { id: session.user.id },
				select: { homeCurrency: true },
			});
			const homeCurrency = user?.homeCurrency ?? "USD";

			// Batch-fetch all needed exchange rates in one pass
			const currenciesNeeded = new Set<string>();
			for (const t of templates) {
				if (t.currency !== homeCurrency) {
					currenciesNeeded.add(t.currency);
					if (homeCurrency !== "USD") currenciesNeeded.add(homeCurrency);
				}
			}

			const rateCache = new RateCache(db);
			const rateMap = await rateCache.getMany(
				[...currenciesNeeded],
				new Date(),
			);

			const enrichedTemplates = templates.map((t) => {
				const fromRate =
					t.currency === "USD" ? 1 : (rateMap.get(t.currency)?.rate ?? null);
				const toRate =
					homeCurrency === "USD"
						? 1
						: (rateMap.get(homeCurrency)?.rate ?? null);
				// Null when a rate is missing: never priced at 1:1
				const amountInHome =
					t.currency === homeCurrency
						? dec(t.amount)
						: fromRate !== null && toRate !== null
							? convertDec(t.amount, t.currency, fromRate, homeCurrency, toRate)
							: null;
				const exchangeRate = fromRate;

				return {
					...t,
					// Prisma Decimal can't cross the RSC boundary (this query is
					// server-prefetched in recurring/layout.tsx and dehydrated into
					// HydrateClient). Return a plain number.
					amount: toFloat(t.amount),
					amountInHomeCurrency:
						amountInHome === null ? null : toFloat(amountInHome, 15),
					exchangeRate,
				};
			});

			return enrichedTemplates;
		}),

	get: protectedProcedure
		.input(
			z.object({
				id: z.cuid(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const template = await db.recurringTemplate.findFirst({
				where: {
					id: input.id,
					userId: session.user.id,
				},
				include: {
					category: {
						select: {
							id: true,
							name: true,
							color: true,
						},
					},
					expenses: {
						select: {
							id: true,
							title: true,
							amount: true,
							date: true,
						},
						orderBy: {
							date: "desc",
						},
						take: 10,
					},
				},
			});

			if (!template) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Recurring template not found",
				});
			}

			return template;
		}),

	create: protectedProcedure
		.input(createRecurringInput)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			// The picker's Date is a calendar day in the browser's zone; the service
			// keeps that day at the start of the user's saved zone.
			const { id } = await createTemplate(db, session.user.id, {
				name: input.name,
				amount: String(input.amount),
				currency: input.currency,
				categoryId: input.categoryId,
				frequency: input.frequency,
				nextDueDate: dayKey(input.nextDueDate, ctx.timeZone),
				websiteUrl: input.websiteUrl,
				paymentSource: input.paymentSource,
				autoPay: input.autoPay,
			});

			return db.recurringTemplate.findUniqueOrThrow({
				where: { id },
				include: {
					category: { select: { id: true, name: true, color: true } },
				},
			});
		}),

	update: protectedProcedure
		.input(updateRecurringInput)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const existing = await db.recurringTemplate.findFirst({
				where: {
					id: input.id,
					userId: session.user.id,
				},
			});

			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Recurring template not found",
				});
			}

			// The edit form sends back the due date it loaded, an instant read in
			// the browser's zone. That is no change and must not move the day.
			const dateChanged =
				input.nextDueDate !== undefined &&
				input.nextDueDate.getTime() !== existing.nextDueDate.getTime();
			await updateTemplate(db, session.user.id, input.id, {
				name: input.name,
				amount: input.amount === undefined ? undefined : String(input.amount),
				currency: input.currency,
				categoryId: input.categoryId,
				frequency: input.frequency,
				nextDueDate:
					dateChanged && input.nextDueDate
						? dayKey(input.nextDueDate, ctx.timeZone)
						: undefined,
				websiteUrl: input.websiteUrl,
				paymentSource: input.paymentSource,
				autoPay: input.autoPay,
				isActive: input.isActive,
			});

			return db.recurringTemplate.findUniqueOrThrow({
				where: { id: input.id },
				include: {
					category: { select: { id: true, name: true, color: true } },
				},
			});
		}),

	delete: protectedProcedure
		.input(
			z.object({
				id: z.cuid(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const result = await db.recurringTemplate.deleteMany({
				where: {
					id: input.id,
					userId: session.user.id,
				},
			});

			if (result.count === 0) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Recurring template not found",
				});
			}

			return { success: true };
		}),

	/**
	 * Due templates waiting for a confirm: autoPay off, or an amount that
	 * varies (ASK), which never posts on its own whatever autoPay says.
	 */
	getPendingConfirmation: protectedProcedure.query(async ({ ctx }) => {
		const { session, db } = ctx;

		const pending = await db.recurringTemplate.findMany({
			where: {
				userId: session.user.id,
				isActive: true,
				OR: [{ autoPay: false }, { amountMode: "ASK" }],
				// Due once its day has come in the user's zone, whatever hour it holds.
				nextDueDate: { lt: startOfNextDayIn(new Date(), ctx.timeZone) },
			},
			include: {
				category: {
					select: {
						id: true,
						name: true,
						color: true,
					},
				},
			},
			orderBy: {
				nextDueDate: "asc",
			},
		});

		return pending;
	}),

	/**
	 * Confirm a pending recurring template and create the expense. The same
	 * mutation /api/v1 and the confirm preview run (recurring-confirm.mutation.ts),
	 * so this is the only place the money is written.
	 */
	confirmAndCreate: protectedProcedure
		.input(
			z.object({
				id: z.cuid(),
				// The due date the user is confirming. When sent, a repeat of the
				// same confirm (double click, second tab) is rejected instead of
				// booking the next period.
				dueDate: z.date().optional(),
				// The real amount, required for a template whose amount varies (ASK).
				amount: z.number().positive().optional(),
				paidOn: z.iso.date().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const amount = input.amount?.toString(); // as typed, no float math
			const done = await userTransaction(ctx.db, userId, (tx) =>
				confirmRecurringExpense.run(
					tx,
					{
						templateId: input.id,
						dueDate: input.dueDate,
						amount,
						paidOn: input.paidOn,
						timeZone: ctx.timeZone,
					},
					{ userId },
				),
			);
			return done.value;
		}),
});
