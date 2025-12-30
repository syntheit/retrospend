import { TRPCError } from "@trpc/server";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import JSZip from "jszip";
import { z } from "zod";
import { CATEGORY_COLORS } from "~/lib/constants";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getAppSettings } from "~/server/services/settings";

export const userRouter = createTRPCRouter({
	updateProfile: protectedProcedure
		.input(
			z
				.object({
					name: z.string().min(1, "Name is required"),
					username: z.string().min(1, "Username is required"),
					email: z.string().email("Invalid email address"),
					password: z
						.string()
						.min(8, "Password must be at least 8 characters")
						.optional(),
					currentPassword: z
						.string()
						.min(8, "Current password is required when changing password")
						.optional(),
				})
				.refine((data) => !data.password || !!data.currentPassword, {
					message: "Current password is required",
					path: ["currentPassword"],
				}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			// Check if username or email is already taken by another user
			if (input.username !== session.user.username) {
				const existingUsername = await db.user.findUnique({
					where: { username: input.username },
				});
				if (existingUsername) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "Username is already taken",
					});
				}
			}

			if (input.email !== session.user.email) {
				const existingEmail = await db.user.findUnique({
					where: { email: input.email },
				});
				if (existingEmail) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "Email is already in use",
					});
				}
			}

			// Update user profile
			const updatedUser = await db.user.update({
				where: { id: session.user.id },
				data: {
					name: input.name,
					username: input.username,
					email: input.email,
				},
				select: {
					id: true,
					name: true,
					username: true,
					email: true,
				},
			});

			// Update password if provided
			if (input.password?.trim()) {
				const credentialAccount = await db.account.findFirst({
					where: {
						userId: session.user.id,
						providerId: "credential",
					},
				});

				if (!credentialAccount?.password) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Password change is not available for this account",
					});
				}

				const isCurrentValid = await verifyPassword({
					password: input.currentPassword ?? "",
					hash: credentialAccount.password,
				});

				if (!isCurrentValid) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Current password is incorrect",
					});
				}

				const hashedPassword = await hashPassword(input.password);

				await db.account.updateMany({
					where: {
						userId: session.user.id,
						providerId: "credential",
					},
					data: {
						password: hashedPassword,
					},
				});
			}

			return updatedUser;
		}),

	deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
		const { session, db } = ctx;

		// Delete user account - cascade will handle related records
		await db.user.delete({
			where: { id: session.user.id },
		});

		return { success: true };
	}),

	listCategories: protectedProcedure.query(async ({ ctx }) => {
		const { session, db } = ctx;

		const categories = await db.category.findMany({
			where: {
				userId: session.user.id,
			},
			orderBy: [
				{
					expenses: {
						_count: "desc",
					},
				},
				{
					name: "asc",
				},
			],
			select: {
				id: true,
				name: true,
				color: true,
				_count: {
					select: {
						expenses: true,
					},
				},
			},
		});

		return categories;
	}),

	createCategory: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1, "Category name is required"),
				color: z.enum(CATEGORY_COLORS, {
					message: "Category color is invalid",
				}),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			// Check if category name already exists for this user
			const existingCategory = await db.category.findUnique({
				where: {
					name_userId: {
						name: input.name,
						userId: session.user.id,
					},
				},
			});

			if (existingCategory) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Category name already exists",
				});
			}

			const category = await db.category.create({
				data: {
					name: input.name,
					color: input.color,
					userId: session.user.id,
				},
				select: {
					id: true,
					name: true,
					color: true,
				},
			});

			return category;
		}),

	updateCategory: protectedProcedure
		.input(
			z.object({
				id: z.string().cuid(),
				name: z.string().min(1, "Category name is required"),
				color: z.enum(CATEGORY_COLORS, {
					message: "Category color is invalid",
				}),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			// Check if another category with this name exists for this user
			const existingCategory = await db.category.findFirst({
				where: {
					name: input.name,
					userId: session.user.id,
					id: { not: input.id },
				},
			});

			if (existingCategory) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Category name already exists",
				});
			}

			const category = await db.category.update({
				where: {
					id: input.id,
					userId: session.user.id,
				},
				data: {
					name: input.name,
					color: input.color,
				},
				select: {
					id: true,
					name: true,
					color: true,
				},
			});

			return category;
		}),

	deleteCategory: protectedProcedure
		.input(
			z.object({
				id: z.string().cuid(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			// Check if category has expenses
			const expensesCount = await db.expense.count({
				where: {
					categoryId: input.id,
					userId: session.user.id,
				},
			});

			if (expensesCount > 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Cannot delete category that has expenses",
				});
			}

			await db.category.delete({
				where: {
					id: input.id,
					userId: session.user.id,
				},
			});

			return { success: true };
		}),

	getSettings: protectedProcedure.query(async ({ ctx }) => {
		const { session, db } = ctx;

		const user = await db.user.findUnique({
			where: { id: session.user.id },
			select: {
				homeCurrency: true,
				defaultCurrency: true,
				categoryClickBehavior: true,
				fontPreference: true,
				currencySymbolStyle: true,
				monthlyIncome: true,
				budgetMode: true,
			},
		});

		if (!user) {
			throw new Error("User not found");
		}

		const appSettings = await getAppSettings();

		return {
			homeCurrency: user.homeCurrency,
			defaultCurrency: user.defaultCurrency,
			categoryClickBehavior: user.categoryClickBehavior,
			fontPreference: user.fontPreference,
			currencySymbolStyle: user.currencySymbolStyle,
			monthlyIncome: user.monthlyIncome,
			budgetMode: user.budgetMode,
			allowAllUsersToGenerateInvites:
				appSettings.allowAllUsersToGenerateInvites,
		};
	}),

	getFavoriteCurrencies: protectedProcedure.query(async ({ ctx }) => {
		const { session, db } = ctx;

		const favorites = await db.exchangeRateFavorite.findMany({
			where: {
				userId: session.user.id,
			},
			include: {
				exchangeRate: {
					select: {
						currency: true,
					},
				},
			},
			orderBy: {
				order: "asc",
			},
		});

		const seen = new Set<string>();
		const favoriteCurrencies: string[] = [];

		for (const favorite of favorites) {
			const currency = favorite.exchangeRate.currency;
			if (!seen.has(currency)) {
				seen.add(currency);
				favoriteCurrencies.push(currency);
			}
		}

		return favoriteCurrencies;
	}),

	updateSettings: protectedProcedure
		.input(
			z.object({
				homeCurrency: z.string().length(3, "Currency must be 3 characters"),
				defaultCurrency: z
					.string()
					.length(3, "Currency must be 3 characters")
					.optional(),
				categoryClickBehavior: z.enum(["navigate", "toggle"]).optional(),
				fontPreference: z.enum(["sans", "mono"]).optional(),
				currencySymbolStyle: z.enum(["native", "standard"]).optional(),
				budgetMode: z.enum(["GLOBAL_LIMIT", "SUM_OF_CATEGORIES"]).optional(),
				monthlyIncome: z
					.number()
					.min(0, "Monthly income must be non-negative")
					.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const updatedUser = await db.user.update({
				where: { id: session.user.id },
				data: {
					homeCurrency: input.homeCurrency,
					...(input.categoryClickBehavior && {
						categoryClickBehavior: input.categoryClickBehavior,
					}),
					...(input.fontPreference && {
						fontPreference: input.fontPreference,
					}),
					...(input.currencySymbolStyle && {
						currencySymbolStyle: input.currencySymbolStyle,
					}),
					...(input.budgetMode && {
						budgetMode: input.budgetMode,
					}),
					...(input.defaultCurrency && {
						defaultCurrency: input.defaultCurrency,
					}),
					...(input.monthlyIncome !== undefined && {
						monthlyIncome: input.monthlyIncome,
					}),
				},
				select: {
					homeCurrency: true,
					defaultCurrency: true,
					categoryClickBehavior: true,
					currencySymbolStyle: true,
					budgetMode: true,
				},
			});

			return updatedUser;
		}),
	getFavoriteExchangeRates: protectedProcedure.query(async ({ ctx }) => {
		const { session, db } = ctx;

		const favorites = await db.exchangeRateFavorite.findMany({
			where: {
				userId: session.user.id,
			},
			include: {
				exchangeRate: true,
			},
			orderBy: {
				order: "asc",
			},
		});

		return favorites.map((f) => ({
			id: f.exchangeRateId,
			order: f.order,
			rate: f.exchangeRate,
		}));
	}),

	reorderFavorites: protectedProcedure
		.input(
			z.object({
				exchangeRateIds: z.array(z.string()),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;
			const { exchangeRateIds } = input;

			await db.$transaction(
				exchangeRateIds.map((id, index) =>
					db.exchangeRateFavorite.update({
						where: {
							userId_exchangeRateId: {
								userId: session.user.id,
								exchangeRateId: id,
							},
						},
						data: {
							order: index,
						},
					}),
				),
			);

			return { success: true };
		}),

	getFavoriteExchangeRateIds: protectedProcedure.query(async ({ ctx }) => {
		const { session, db } = ctx;

		const favorites = await db.exchangeRateFavorite.findMany({
			where: {
				userId: session.user.id,
			},
			select: {
				exchangeRateId: true,
			},
		});

		return favorites.map((favorite) => favorite.exchangeRateId);
	}),
	toggleFavoriteExchangeRate: protectedProcedure
		.input(
			z.object({
				exchangeRateId: z.string().cuid(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const rate = await db.exchangeRate.findUnique({
				where: {
					id: input.exchangeRateId,
				},
			});

			if (!rate) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Exchange rate not found",
				});
			}

			const existingFavorite = await db.exchangeRateFavorite.findUnique({
				where: {
					userId_exchangeRateId: {
						userId: session.user.id,
						exchangeRateId: input.exchangeRateId,
					},
				},
			});

			if (existingFavorite) {
				await db.exchangeRateFavorite.delete({
					where: {
						id: existingFavorite.id,
					},
				});
				return { isFavorite: false };
			}

			const maxOrder = await db.exchangeRateFavorite.findFirst({
				where: { userId: session.user.id },
				orderBy: { order: "desc" },
				select: { order: true },
			});

			const nextOrder = (maxOrder?.order ?? -1) + 1;

			await db.exchangeRateFavorite.create({
				data: {
					userId: session.user.id,
					exchangeRateId: input.exchangeRateId,
					order: nextOrder,
				},
			});

			return { isFavorite: true };
		}),

	exportAllData: protectedProcedure.mutation(async ({ ctx }) => {
		const { session, db } = ctx;

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

		const zip = new JSZip();

		// 1. User Profile Data
		const user = await db.user.findUnique({
			where: { id: session.user.id },
			select: {
				id: true,
				name: true,
				username: true,
				email: true,
				emailVerified: true,
				homeCurrency: true,
				categoryClickBehavior: true,
				role: true,
				isActive: true,
				createdAt: true,
				updatedAt: true,
			},
		});

		if (user) {
			const userHeader = [
				"id",
				"name",
				"username",
				"email",
				"emailVerified",
				"homeCurrency",
				"categoryClickBehavior",
				"role",
				"isActive",
				"createdAt",
				"updatedAt",
			];
			const userRow = [
				escapeValue(user.id),
				escapeValue(user.name),
				escapeValue(user.username),
				escapeValue(user.email),
				escapeValue(user.emailVerified),
				escapeValue(user.homeCurrency),
				escapeValue(user.categoryClickBehavior),
				escapeValue(user.role),
				escapeValue(user.isActive),
				escapeValue(user.createdAt),
				escapeValue(user.updatedAt),
			];
			const userCsv = [userHeader, userRow]
				.map((row) => row.join(","))
				.join("\n");
			zip.file("user_profile.csv", userCsv);
		}

		// 2. Categories
		const categories = await db.category.findMany({
			where: { userId: session.user.id },
			orderBy: { name: "asc" },
		});

		if (categories.length > 0) {
			const categoryHeader = ["id", "name", "color"];
			const categoryRows = categories.map((category) => [
				escapeValue(category.id),
				escapeValue(category.name),
				escapeValue(category.color),
			]);
			const categoryCsv = [categoryHeader, ...categoryRows]
				.map((row) => row.join(","))
				.join("\n");
			zip.file("categories.csv", categoryCsv);
		}

		// 3. Expenses (using existing logic)
		const expenses = await db.expense.findMany({
			where: { userId: session.user.id },
			orderBy: { date: "desc" },
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

		if (expenses.length > 0) {
			const expenseHeader = [
				"id",
				"title",
				"amount",
				"currency",
				"exchangeRate",
				"amountInUSD",
				"date",
				"location",
				"description",
				"pricingSource",
				"status",
				"categoryId",
				"categoryName",
				"categoryColor",
				"createdAt",
				"updatedAt",
			];
			const expenseRows = expenses.map((expense) => [
				escapeValue(expense.id),
				escapeValue(expense.title),
				escapeValue(expense.amount),
				escapeValue(expense.currency),
				escapeValue(expense.exchangeRate),
				escapeValue(expense.amountInUSD),
				escapeValue(expense.date),
				escapeValue(expense.location),
				escapeValue(expense.description),
				escapeValue(expense.pricingSource),
				escapeValue(expense.status),
				escapeValue(expense.categoryId),
				escapeValue(expense.category?.name),
				escapeValue(expense.category?.color),
				escapeValue(expense.createdAt),
				escapeValue(expense.updatedAt),
			]);
			const expenseCsv = [expenseHeader, ...expenseRows]
				.map((row) => row.join(","))
				.join("\n");
			zip.file("expenses.csv", expenseCsv);
		}

		// 4. Asset Accounts (Wealth data)
		const assets = await db.assetAccount.findMany({
			where: { userId: session.user.id },
			orderBy: { createdAt: "asc" },
		});

		if (assets.length > 0) {
			const assetHeader = [
				"id",
				"name",
				"type",
				"currency",
				"balance",
				"exchangeRate",
				"exchangeRateType",
				"isLiquid",
				"createdAt",
				"updatedAt",
			];
			const assetRows = assets.map((asset) => [
				escapeValue(asset.id),
				escapeValue(asset.name),
				escapeValue(asset.type),
				escapeValue(asset.currency),
				escapeValue(asset.balance),
				escapeValue(asset.exchangeRate),
				escapeValue(asset.exchangeRateType),
				escapeValue(asset.isLiquid),
				escapeValue(asset.createdAt),
				escapeValue(asset.updatedAt),
			]);
			const assetCsv = [assetHeader, ...assetRows]
				.map((row) => row.join(","))
				.join("\n");
			zip.file("asset_accounts.csv", assetCsv);
		}

		// 5. Asset Snapshots (Historical wealth data)
		const snapshots = await db.assetSnapshot.findMany({
			where: {
				account: {
					userId: session.user.id,
				},
			},
			include: {
				account: {
					select: {
						id: true,
						name: true,
					},
				},
			},
			orderBy: [{ accountId: "asc" }, { date: "asc" }],
		});

		if (snapshots.length > 0) {
			const snapshotHeader = [
				"id",
				"accountId",
				"accountName",
				"date",
				"balance",
				"balanceInUSD",
			];
			const snapshotRows = snapshots.map((snapshot) => [
				escapeValue(snapshot.id),
				escapeValue(snapshot.accountId),
				escapeValue(snapshot.account.name),
				escapeValue(snapshot.date),
				escapeValue(snapshot.balance),
				escapeValue(snapshot.balanceInUSD),
			]);
			const snapshotCsv = [snapshotHeader, ...snapshotRows]
				.map((row) => row.join(","))
				.join("\n");
			zip.file("asset_snapshots.csv", snapshotCsv);
		}

		// 6. Favorite Exchange Rates
		const favorites = await db.exchangeRateFavorite.findMany({
			where: { userId: session.user.id },
			include: {
				exchangeRate: true,
			},
			orderBy: { order: "asc" },
		});

		if (favorites.length > 0) {
			const favoriteHeader = [
				"id",
				"exchangeRateId",
				"currency",
				"date",
				"type",
				"rate",
				"order",
				"createdAt",
			];
			const favoriteRows = favorites.map((favorite) => [
				escapeValue(favorite.id),
				escapeValue(favorite.exchangeRateId),
				escapeValue(favorite.exchangeRate.currency),
				escapeValue(favorite.exchangeRate.date),
				escapeValue(favorite.exchangeRate.type),
				escapeValue(favorite.exchangeRate.rate),
				escapeValue(favorite.order),
				escapeValue(favorite.createdAt),
			]);
			const favoriteCsv = [favoriteHeader, ...favoriteRows]
				.map((row) => row.join(","))
				.join("\n");
			zip.file("favorite_exchange_rates.csv", favoriteCsv);
		}

		// 7. Invite Codes (if user created any)
		const inviteCodes = await db.inviteCode.findMany({
			where: { createdById: session.user.id },
		});

		if (inviteCodes.length > 0) {
			const inviteHeader = [
				"id",
				"code",
				"isActive",
				"usedAt",
				"expiresAt",
				"createdAt",
			];
			const inviteRows = inviteCodes.map((invite) => [
				escapeValue(invite.id),
				escapeValue(invite.code),
				escapeValue(invite.isActive),
				escapeValue(invite.usedAt),
				escapeValue(invite.expiresAt),
				escapeValue(invite.createdAt),
			]);
			const inviteCsv = [inviteHeader, ...inviteRows]
				.map((row) => row.join(","))
				.join("\n");
			zip.file("invite_codes.csv", inviteCsv);
		}

		// Generate the zip file
		const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
		// Convert Buffer to base64 for tRPC serialization
		const zipData = zipBuffer.toString("base64");

		return {
			zipData,
			filename: `user-data-${new Date().toISOString().slice(0, 10)}.zip`,
		};
	}),
});
