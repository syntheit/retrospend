import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { convertAmount } from "~/lib/money";
import { nextRecurringDate } from "~/lib/recurring";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { recurringEntryData } from "~/server/services/money-in.service";
import { RateCache } from "~/server/services/rate-cache";

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
				const amount = Number(t.amount);
				const fromRate =
					t.currency === "USD" ? 1 : (rateMap.get(t.currency)?.rate ?? null);
				const toRate =
					homeCurrency === "USD"
						? 1
						: (rateMap.get(homeCurrency)?.rate ?? null);
				// Null when a rate is missing: never priced at 1:1
				const amountInHomeCurrency =
					t.currency === homeCurrency
						? amount
						: fromRate !== null && toRate !== null
							? convertAmount(
									amount,
									t.currency,
									fromRate,
									homeCurrency,
									toRate,
								)
							: null;
				const exchangeRate = fromRate;

				return {
					...t,
					// Prisma Decimal can't cross the RSC boundary (this query is
					// server-prefetched in recurring/layout.tsx and dehydrated into
					// HydrateClient). Return a plain number.
					amount: Number(t.amount),
					amountInHomeCurrency,
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
		.input(
			z.object({
				name: z.string().min(1).max(191),
				amount: z.number().positive(),
				currency: z.string().length(3).default("USD"),
				categoryId: z.cuid().optional(),
				frequency: z.enum([
					"WEEKLY",
					"BIWEEKLY",
					"MONTHLY",
					"QUARTERLY",
					"YEARLY",
				]),
				nextDueDate: z.date(),
				websiteUrl: z.url().max(512).optional(),
				paymentSource: z.string().min(1).max(191).optional(),
				autoPay: z.boolean().default(true),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			// Validate category if provided
			if (input.categoryId) {
				const category = await db.category.findFirst({
					where: { id: input.categoryId, userId: session.user.id },
				});
				if (!category) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "Category not found",
					});
				}
			}

			const template = await db.recurringTemplate.create({
				data: {
					userId: session.user.id,
					name: input.name,
					amount: input.amount,
					currency: input.currency,
					categoryId: input.categoryId,
					frequency: input.frequency,
					nextDueDate: input.nextDueDate,
					anchorDay: input.nextDueDate.getDate(),
					websiteUrl: input.websiteUrl,
					paymentSource: input.paymentSource,
					autoPay: input.autoPay,
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

			return template;
		}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.cuid(),
				name: z.string().min(1).max(191).optional(),
				amount: z.number().positive().optional(),
				currency: z.string().length(3).optional(),
				categoryId: z.cuid().nullable().optional(),
				frequency: z
					.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"])
					.optional(),
				nextDueDate: z.date().optional(),
				websiteUrl: z.url().max(512).nullable().optional(),
				paymentSource: z.string().min(1).max(191).nullable().optional(),
				autoPay: z.boolean().optional(),
				isActive: z.boolean().optional(),
			}),
		)
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

			// Validate category if provided
			if (input.categoryId) {
				const category = await db.category.findFirst({
					where: { id: input.categoryId, userId: session.user.id },
				});
				if (!category) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "Category not found",
					});
				}
			}

			const template = await db.recurringTemplate.update({
				where: { id: input.id },
				data: {
					name: input.name,
					amount: input.amount,
					currency: input.currency,
					categoryId: input.categoryId,
					frequency: input.frequency,
					nextDueDate: input.nextDueDate,
					// A due date the user sets is the new anchor for monthly steps.
					...(input.nextDueDate && {
						anchorDay: input.nextDueDate.getDate(),
					}),
					websiteUrl: input.websiteUrl,
					paymentSource: input.paymentSource,
					autoPay: input.autoPay,
					isActive: input.isActive,
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

			return template;
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
		const now = new Date();

		const pending = await db.recurringTemplate.findMany({
			where: {
				userId: session.user.id,
				isActive: true,
				OR: [{ autoPay: false }, { amountMode: "ASK" }],
				nextDueDate: {
					lte: now,
				},
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
	 * Confirm a pending recurring template and create the expense
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
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const template = await db.recurringTemplate.findFirst({
				where: {
					id: input.id,
					userId: session.user.id,
					isActive: true,
				},
			});

			if (!template) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Recurring template not found",
				});
			}

			if (
				(input.dueDate &&
					input.dueDate.getTime() !== template.nextDueDate.getTime()) ||
				template.nextDueDate > new Date()
			) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "This payment was already confirmed",
				});
			}

			// Direction, amount and the due date's rate (never 1) for the row.
			const entry = await recurringEntryData(db, template, input.amount);

			const nextDueDate = nextRecurringDate(
				template.nextDueDate,
				template.frequency,
				template.anchorDay,
			);

			// Advance the template and create the expense in one transaction.
			// The advance only succeeds while nextDueDate is still the one read
			// above, so two confirms racing each other create a single expense.
			const expense = await db.$transaction(async (tx) => {
				await tx.$executeRaw`SELECT set_config('app.current_user_id', ${session.user.id}, true),
				                            set_config('role', 'retrospend_app', true)`;
				const advanced = await tx.recurringTemplate.updateMany({
					where: {
						id: template.id,
						userId: session.user.id,
						nextDueDate: template.nextDueDate,
					},
					data: {
						nextDueDate,
						anchorDay: template.anchorDay ?? template.nextDueDate.getDate(),
					},
				});
				if (advanced.count === 0) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "This payment was already confirmed",
					});
				}

				return await tx.expense.create({ data: entry });
			});

			return expense;
		}),
});
