import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { BASE_CURRENCY } from "~/lib/constants";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { fromUSD, toUSD } from "~/server/currency";
import { RateCache } from "~/server/services/rate-cache";
import { getBestExchangeRate } from "./shared-currency";

// Helper to calculate next due date based on frequency
function calculateNextDueDate(
	currentDate: Date,
	frequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY",
): Date {
	const next = new Date(currentDate);

	switch (frequency) {
		case "WEEKLY":
			next.setDate(next.getDate() + 7);
			break;
		case "BIWEEKLY":
			next.setDate(next.getDate() + 14);
			break;
		case "MONTHLY":
			next.setMonth(next.getMonth() + 1);
			break;
		case "QUARTERLY":
			next.setMonth(next.getMonth() + 3);
			break;
		case "YEARLY":
			next.setFullYear(next.getFullYear() + 1);
			break;
	}

	return next;
}

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
			const rateMap = await rateCache.getMany([...currenciesNeeded], new Date());

			const enrichedTemplates = templates.map((t) => {
				let amountInHomeCurrency = Number(t.amount);
				let exchangeRate = 1;

				if (t.currency !== homeCurrency) {
					const bestRateFrom = rateMap.get(t.currency);

					let usdValue = Number(t.amount);
					if (t.currency !== "USD" && bestRateFrom) {
						exchangeRate = bestRateFrom.rate;
						usdValue = toUSD(Number(t.amount), t.currency, bestRateFrom.rate);
					}

					if (homeCurrency === "USD") {
						amountInHomeCurrency = usdValue;
					} else {
						const bestRateTo = rateMap.get(homeCurrency);
						if (bestRateTo) {
							amountInHomeCurrency = fromUSD(usdValue, homeCurrency, bestRateTo.rate);
						} else {
							amountInHomeCurrency = usdValue;
						}
					}
				}

				return {
					...t,
					amountInHomeCurrency,
					exchangeRate,
				};
			});

			return enrichedTemplates;
		}),

	get: protectedProcedure
		.input(
			z.object({
				id: z.string().cuid(),
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
				categoryId: z.string().cuid().optional(),
				frequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]),
				nextDueDate: z.date(),
				websiteUrl: z.string().url().max(512).optional(),
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
				id: z.string().cuid(),
				name: z.string().min(1).max(191).optional(),
				amount: z.number().positive().optional(),
				currency: z.string().length(3).optional(),
				categoryId: z.string().cuid().nullable().optional(),
				frequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]).optional(),
				nextDueDate: z.date().optional(),
				websiteUrl: z.string().url().max(512).nullable().optional(),
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
				id: z.string().cuid(),
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
	 * Get templates that are pending confirmation (autoPay = false and due)
	 */
	getPendingConfirmation: protectedProcedure.query(async ({ ctx }) => {
		const { session, db } = ctx;
		const now = new Date();

		const pending = await db.recurringTemplate.findMany({
			where: {
				userId: session.user.id,
				isActive: true,
				autoPay: false,
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
				id: z.string().cuid(),
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

			// Get exchange rate
			let exchangeRate = 1;
			let amountInUSD = Number(template.amount);

			if (template.currency !== BASE_CURRENCY) {
				const bestRate = await getBestExchangeRate(
					db,
					template.currency,
					template.nextDueDate,
				);
				if (bestRate) {
					exchangeRate = bestRate.rate;
					amountInUSD = toUSD(Number(template.amount), template.currency, exchangeRate);
				}
			}

			// Calculate next due date
			const nextDueDate = calculateNextDueDate(
				template.nextDueDate,
				template.frequency,
			);

			// Create expense and update template in a transaction
			// This prevents orphaned expenses if the nextDueDate update fails
			const expense = await db.$transaction(async (tx) => {
				await tx.$executeRaw`SELECT set_config('app.current_user_id', ${session.user.id}, true),
				                            set_config('role', 'retrospend_app', true)`;
				const createdExpense = await tx.expense.create({
					data: {
						userId: session.user.id,
						title: template.name,
						amount: template.amount,
						currency: template.currency,
						date: template.nextDueDate,
						categoryId: template.categoryId,
						amountInUSD,
						exchangeRate,
						pricingSource: "RECURRING",
						recurringTemplateId: template.id,
						status: "FINALIZED",
					},
				});

				// Update next due date
				await tx.recurringTemplate.update({
					where: { id: template.id },
					data: { nextDueDate },
				});

				return createdExpense;
			});

			return expense;
		}),
});
