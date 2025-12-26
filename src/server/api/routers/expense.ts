import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const expenseRouter = createTRPCRouter({
	// Create a new draft expense
	createDraft: protectedProcedure
		.input(
			z.object({
				id: z.string().uuid(), // UUID for the expense
				title: z.string(),
				amount: z.number().positive("Amount must be positive"),
				currency: z.string().length(3).default("USD"),
				exchangeRate: z.number().positive().optional(),
				amountInUSD: z.number().positive().optional(),
				pricingSource: z.string().optional(),
				date: z.date(),
				location: z.string().optional(),
				description: z.string().optional(),
				categoryId: z.string().cuid().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

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

			let exchangeRate = input.exchangeRate;
			let amountInUSD = input.amountInUSD;
			const pricingSource = input.pricingSource ?? "MANUAL";

			if (!exchangeRate) {
				if (input.currency === "USD") {
					exchangeRate = 1;
				} else {
					const latestRate = await db.exchangeRate.findFirst({
						where: {
							currency: input.currency,
							date: { lte: input.date },
						},
						orderBy: { date: "desc" },
					});

					if (latestRate) {
						exchangeRate = latestRate.rate.toNumber();
					} else {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: `Exchange rate not found for ${input.currency}.`,
						});
					}
				}
			}

			if (!amountInUSD) {
				amountInUSD = input.amount / exchangeRate;
			}

			const expense = await db.expense.create({
				data: {
					id: input.id,
					userId: session.user.id,
					title: input.title,
					amount: input.amount,
					currency: input.currency,
					exchangeRate: exchangeRate,
					amountInUSD: amountInUSD,
					pricingSource: pricingSource,
					date: input.date,
					location: input.location || undefined,
					description: input.description || undefined,
					categoryId: input.categoryId || undefined,
					status: "DRAFT",
				},
				select: {
					id: true,
					title: true,
					amount: true,
					currency: true,
					exchangeRate: true,
					amountInUSD: true,
					pricingSource: true,
					date: true,
					location: true,
					description: true,
					status: true,
					categoryId: true,
					createdAt: true,
					updatedAt: true,
				},
			});

			return expense;
		}),

	// Update an existing draft expense
	updateDraft: protectedProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				title: z.string(),
				amount: z.number().positive("Amount must be positive"),
				currency: z.string().length(3).default("USD"),
				exchangeRate: z.number().positive().optional(),
				amountInUSD: z.number().positive().optional(),
				pricingSource: z.string().optional(),
				date: z.date(),
				location: z.string().optional(),
				description: z.string().optional(),
				categoryId: z.string().cuid().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const existingDraft = await db.expense.findFirst({
				where: {
					id: input.id,
					userId: session.user.id,
					status: "DRAFT", // Only allow updating drafts
				},
			});

			if (!existingDraft) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
			}

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

			const expense = await db.expense.update({
				where: {
					id: existingDraft.id,
				},
				data: {
					title: input.title,
					amount: input.amount,
					currency: input.currency,
					exchangeRate: input.exchangeRate,
					amountInUSD: input.amountInUSD,
					pricingSource: input.pricingSource,
					date: input.date,
					location: input.location || undefined,
					description: input.description || undefined,
					categoryId: input.categoryId || undefined,
				},
				select: {
					id: true,
					title: true,
					amount: true,
					currency: true,
					exchangeRate: true,
					amountInUSD: true,
					pricingSource: true,
					date: true,
					location: true,
					description: true,
					status: true,
					categoryId: true,
					createdAt: true,
					updatedAt: true,
				},
			});

			return expense;
		}),

	// Update any expense (draft or finalized)
	updateExpense: protectedProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				title: z.string(),
				amount: z.number().positive("Amount must be positive"),
				currency: z.string().length(3).default("USD"),
				exchangeRate: z.number().positive().optional(),
				amountInUSD: z.number().positive().optional(),
				pricingSource: z.string().optional(),
				date: z.date(),
				location: z.string().optional(),
				description: z.string().optional(),
				categoryId: z.string().cuid().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const existingExpense = await db.expense.findFirst({
				where: {
					id: input.id,
					userId: session.user.id,
				},
			});

			if (!existingExpense) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Expense not found",
				});
			}

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

			const expense = await db.expense.update({
				where: { id: existingExpense.id },
				data: {
					title: input.title,
					amount: input.amount,
					currency: input.currency,
					exchangeRate: input.exchangeRate,
					amountInUSD: input.amountInUSD,
					pricingSource: input.pricingSource,
					date: input.date,
					location: input.location || undefined,
					description: input.description || undefined,
					categoryId: input.categoryId || undefined,
				},
				select: {
					id: true,
					title: true,
					amount: true,
					currency: true,
					exchangeRate: true,
					amountInUSD: true,
					pricingSource: true,
					date: true,
					location: true,
					description: true,
					status: true,
					categoryId: true,
					createdAt: true,
					updatedAt: true,
				},
			});

			return expense;
		}),

	// List all draft expenses for the current user
	listDrafts: protectedProcedure.query(async ({ ctx }) => {
		const { session, db } = ctx;

		const drafts = await db.expense.findMany({
			where: {
				userId: session.user.id,
				status: "DRAFT",
			},
			orderBy: {
				updatedAt: "desc",
			},
			select: {
				id: true,
				title: true,
				amount: true,
				currency: true,
				exchangeRate: true,
				amountInUSD: true,
				date: true,
				location: true,
				description: true,
				categoryId: true,
				category: {
					select: {
						id: true,
						name: true,
						color: true,
					},
				},
				createdAt: true,
				updatedAt: true,
			},
		});

		return drafts;
	}),

	// List all finalized expenses for the current user
	listFinalized: protectedProcedure.query(async ({ ctx }) => {
		const { session, db } = ctx;

		const expenses = await db.expense.findMany({
			where: {
				userId: session.user.id,
				status: "FINALIZED",
			},
			orderBy: {
				date: "desc",
			},
			select: {
				id: true,
				title: true,
				amount: true,
				currency: true,
				exchangeRate: true,
				amountInUSD: true,
				date: true,
				location: true,
				description: true,
				categoryId: true,
				category: {
					select: {
						id: true,
						name: true,
						color: true,
					},
				},
				createdAt: true,
				updatedAt: true,
			},
		});

		return expenses;
	}),

	// Finalize a draft expense (convert to FINALIZED)
	finalizeExpense: protectedProcedure
		.input(
			z.object({
				id: z.string().uuid(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const draft = await db.expense.findFirst({
				where: {
					id: input.id,
					userId: session.user.id,
					status: "DRAFT",
				},
				select: { id: true },
			});

			if (!draft) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Draft not found or already finalized",
				});
			}

			const expense = await db.expense.update({
				where: {
					id: draft.id,
				},
				data: {
					status: "FINALIZED",
				},
				select: {
					id: true,
					title: true,
					amount: true,
					currency: true,
					date: true,
					location: true,
					status: true,
					categoryId: true,
					createdAt: true,
					updatedAt: true,
				},
			});

			return expense;
		}),

	// Get a single expense by ID
	getExpense: protectedProcedure
		.input(
			z.object({
				id: z.string().uuid(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const expense = await db.expense.findFirst({
				where: {
					id: input.id,
					userId: session.user.id,
				},
				select: {
					id: true,
					title: true,
					amount: true,
					currency: true,
					exchangeRate: true,
					amountInUSD: true,
					date: true,
					location: true,
					description: true,
					status: true,
					categoryId: true,
					category: {
						select: {
							id: true,
							name: true,
							color: true,
						},
					},
					createdAt: true,
					updatedAt: true,
				},
			});

			return expense;
		}),

	// Delete an expense (draft or finalized)
	deleteExpense: protectedProcedure
		.input(
			z.object({
				id: z.string().uuid(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const result = await db.expense.deleteMany({
				where: {
					id: input.id,
					userId: session.user.id,
				},
			});

			if (result.count === 0) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Expense not found",
				});
			}

			return { success: true };
		}),

	// Export finalized expenses to CSV
	exportCsv: protectedProcedure
		.input(
			z
				.object({
					includeDrafts: z.boolean().optional(),
					expenseIds: z.array(z.string()).optional(),
				})
				.optional(),
		)
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;

			const expenses = await db.expense.findMany({
				where: {
					userId: session.user.id,
					...(input?.includeDrafts ? {} : { status: "FINALIZED" }),
					...(input?.expenseIds ? { id: { in: input.expenseIds } } : {}),
				},
				orderBy: {
					date: "desc",
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

			const header = [
				"title",
				"amount",
				"currency",
				"exchangeRate",
				"amountInUSD",
				"date",
				"location",
				"description",
				"pricingSource",
				"category",
			];

			const escapeValue = (raw: unknown): string => {
				if (raw === null || raw === undefined) return "";
				const value =
					raw instanceof Date
						? (raw.toISOString().split("T")[0] ?? "")
						: typeof raw === "number" || typeof raw === "bigint"
							? raw.toString()
							: String(raw);

				const needsEscaping = /["\n,]/.test(value);
				if (!needsEscaping) return value;
				return `"${value.replace(/"/g, '""')}"`;
			};

			const rows = expenses.map((expense) => [
				escapeValue(expense.title),
				escapeValue(expense.amount),
				escapeValue(expense.currency),
				escapeValue(expense.exchangeRate),
				escapeValue(expense.amountInUSD),
				escapeValue(expense.date),
				escapeValue(expense.location),
				escapeValue(expense.description),
				escapeValue(expense.pricingSource),
				escapeValue(expense.category?.name),
			]);

			const csv = [header, ...rows].map((row) => row.join(",")).join("\n");

			return { csv };
		}),

	// Import expenses from parsed CSV rows
	importExpenses: protectedProcedure
		.input(
			z.object({
				rows: z
					.array(
						z.object({
							title: z.string().min(1),
							amount: z.number().positive(),
							currency: z.string().length(3),
							date: z.date(),
							exchangeRate: z.number().positive().optional(),
							amountInUSD: z.number().positive().optional(),
							location: z.string().nullable().optional(),
							description: z.string().nullable().optional(),
							categoryId: z.string().cuid().nullable().optional(),
							pricingSource: z.string().nullable().optional(),
						}),
					)
					.min(1, "At least one row is required")
					.max(1000, "Please import 1000 rows or fewer at a time"),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;

			// Validate category ownership
			const categoryIds = Array.from(
				new Set(
					input.rows
						.map((row) => row.categoryId)
						.filter((id): id is string => Boolean(id)),
				),
			);

			let validCategoryIds = new Set<string>();
			if (categoryIds.length > 0) {
				const categories = await db.category.findMany({
					where: {
						id: { in: categoryIds },
						userId: session.user.id,
					},
					select: { id: true },
				});
				validCategoryIds = new Set(categories.map((category) => category.id));
			}

			const data = input.rows.map((row) => {
				const exchangeRate =
					row.exchangeRate ?? (row.currency.toUpperCase() === "USD" ? 1 : null);
				const amountInUSD =
					row.amountInUSD ?? (exchangeRate ? row.amount / exchangeRate : null);

				if (!exchangeRate || !amountInUSD) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message:
							"Each row must include exchangeRate or amountInUSD (or use USD currency).",
					});
				}

				const categoryId =
					row.categoryId && validCategoryIds.has(row.categoryId)
						? row.categoryId
						: null;

				return {
					id: randomUUID(),
					userId: session.user.id,
					title: row.title,
					amount: row.amount,
					currency: row.currency.toUpperCase(),
					date: row.date,
					categoryId: categoryId ?? undefined,
					amountInUSD: amountInUSD,
					exchangeRate: exchangeRate,
					pricingSource: row.pricingSource ?? "IMPORT",
					location: row.location ?? undefined,
					description: row.description ?? undefined,
					status: "FINALIZED" as const,
				};
			});

			const result = await db.expense.createMany({
				data,
			});

			return { count: result.count };
		}),
});
