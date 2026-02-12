import JSZip from "jszip";
import { generateCsv } from "~/lib/csv";
import type { PrismaClient } from "~prisma";

export class ExportService {
	constructor(private db: PrismaClient) {}

	async exportAllData(userId: string) {
		const db = this.db;
		const zip = new JSZip();

		// 1. User Profile Data
		const user = await db.user.findUnique({
			where: { id: userId },
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
				user.id,
				user.name,
				user.username,
				user.email,
				user.emailVerified,
				user.homeCurrency,
				user.categoryClickBehavior,
				user.role,
				user.isActive,
				user.createdAt,
				user.updatedAt,
			];
			zip.file("user_profile.csv", generateCsv(userHeader, [userRow]));
		}

		// 2. Categories
		const categories = await db.category.findMany({
			where: { userId },
			orderBy: { name: "asc" },
		});

		if (categories.length > 0) {
			const categoryHeader = ["id", "name", "color"];
			const categoryRows = categories.map((category) => [
				category.id,
				category.name,
				category.color,
			]);
			zip.file("categories.csv", generateCsv(categoryHeader, categoryRows));
		}

		// 3. Expenses
		const expenses = await db.expense.findMany({
			where: { userId },
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
				expense.id,
				expense.title,
				expense.amount,
				expense.currency,
				expense.exchangeRate,
				expense.amountInUSD,
				expense.date,
				expense.location,
				expense.description,
				expense.pricingSource,
				expense.status,
				expense.categoryId,
				expense.category?.name,
				expense.category?.color,
				expense.createdAt,
				expense.updatedAt,
			]);
			zip.file("expenses.csv", generateCsv(expenseHeader, expenseRows));
		}

		// 4. Asset Accounts
		const assets = await db.assetAccount.findMany({
			where: { userId },
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
				"interestRate",
				"minimumPayment",
				"dueDate",
				"createdAt",
				"updatedAt",
			];
			const assetRows = assets.map((asset) => [
				asset.id,
				asset.name,
				asset.type,
				asset.currency,
				asset.balance,
				asset.exchangeRate,
				asset.exchangeRateType,
				asset.isLiquid,
				asset.interestRate,
				asset.minimumPayment,
				asset.dueDate,
				asset.createdAt,
				asset.updatedAt,
			]);
			zip.file("asset_accounts.csv", generateCsv(assetHeader, assetRows));
		}

		// 5. Asset Snapshots
		const snapshots = await db.assetSnapshot.findMany({
			where: {
				account: {
					userId,
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
				snapshot.id,
				snapshot.accountId,
				snapshot.account.name,
				snapshot.date,
				snapshot.balance,
				snapshot.balanceInUSD,
			]);
			zip.file(
				"asset_snapshots.csv",
				generateCsv(snapshotHeader, snapshotRows),
			);
		}

		// 6. Favorite Exchange Rates
		const favorites = await db.exchangeRateFavorite.findMany({
			where: { userId },
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
				favorite.id,
				favorite.exchangeRateId,
				favorite.exchangeRate.currency,
				favorite.exchangeRate.date,
				favorite.exchangeRate.type,
				favorite.exchangeRate.rate,
				favorite.order,
				favorite.createdAt,
			]);
			zip.file(
				"favorite_exchange_rates.csv",
				generateCsv(favoriteHeader, favoriteRows),
			);
		}

		// 7. Invite Codes
		const inviteCodes = await db.inviteCode.findMany({
			where: { createdById: userId },
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
				invite.id,
				invite.code,
				invite.isActive,
				invite.usedAt,
				invite.expiresAt,
				invite.createdAt,
			]);
			zip.file("invite_codes.csv", generateCsv(inviteHeader, inviteRows));
		}

		// 8. Budgets
		const budgets = await db.budget.findMany({
			where: { userId },
			include: {
				category: {
					select: {
						name: true,
					},
				},
			},
			orderBy: [{ period: "desc" }, { categoryId: "asc" }],
		});

		if (budgets.length > 0) {
			const budgetHeader = [
				"id",
				"amount",
				"period",
				"isRollover",
				"rolloverAmount",
				"pegToActual",
				"categoryId",
				"categoryName",
				"createdAt",
				"updatedAt",
			];
			const budgetRows = budgets.map((budget) => [
				budget.id,
				budget.amount,
				budget.period,
				budget.isRollover,
				budget.rolloverAmount,
				budget.pegToActual,
				budget.categoryId,
				budget.category?.name,
				budget.createdAt,
				budget.updatedAt,
			]);
			zip.file("budgets.csv", generateCsv(budgetHeader, budgetRows));
		}

		const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
		return {
			zipData: zipBuffer.toString("base64"),
			filename: `user-data-${new Date().toISOString().slice(0, 10)}.zip`,
		};
	}
}
