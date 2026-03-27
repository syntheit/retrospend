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
				consentedAt: true,
				consentVersion: true,
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
				"consentedAt",
				"consentVersion",
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
				user.consentedAt ?? "",
				user.consentVersion ?? "",
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

		// 3. Expenses (cursor-based pagination to limit memory usage)
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
			"excludeFromAnalytics",
			"createdAt",
			"updatedAt",
		];
		const EXPENSE_BATCH_SIZE = 2000;
		const expenseRows: unknown[][] = [];
		let expenseCursor: string | undefined;
		let hasMoreExpenses = true;

		while (hasMoreExpenses) {
			const batch = await db.expense.findMany({
				where: { userId },
				orderBy: [{ date: "desc" }, { id: "asc" }],
				include: {
					category: {
						select: { id: true, name: true, color: true },
					},
				},
				take: EXPENSE_BATCH_SIZE,
				...(expenseCursor
					? { skip: 1, cursor: { id: expenseCursor } }
					: {}),
			});

			for (const expense of batch) {
				expenseRows.push([
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
					expense.excludeFromAnalytics,
					expense.createdAt,
					expense.updatedAt,
				]);
			}

			hasMoreExpenses = batch.length === EXPENSE_BATCH_SIZE;
			if (batch.length > 0) {
				expenseCursor = batch[batch.length - 1]!.id;
			}
		}

		if (expenseRows.length > 0) {
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

		// 9. Recurring Templates
		const recurringTemplates = await db.recurringTemplate.findMany({
			where: { userId },
			include: { category: { select: { name: true } } },
			orderBy: { createdAt: "asc" },
		});

		if (recurringTemplates.length > 0) {
			const recurringHeader = [
				"id",
				"name",
				"amount",
				"currency",
				"frequency",
				"nextDueDate",
				"websiteUrl",
				"paymentSource",
				"autoPay",
				"isActive",
				"categoryId",
				"categoryName",
				"createdAt",
				"updatedAt",
			];
			const recurringRows = recurringTemplates.map((t) => [
				t.id,
				t.name,
				t.amount,
				t.currency,
				t.frequency,
				t.nextDueDate,
				t.websiteUrl ?? "",
				t.paymentSource ?? "",
				t.autoPay,
				t.isActive,
				t.categoryId ?? "",
				t.category?.name ?? "",
				t.createdAt,
				t.updatedAt,
			]);
			zip.file(
				"recurring_templates.csv",
				generateCsv(recurringHeader, recurringRows),
			);
		}

		// 10. Notification Preferences
		const notificationPrefs = await db.notificationPreference.findMany({
			where: { userId },
			orderBy: { type: "asc" },
		});

		if (notificationPrefs.length > 0) {
			const prefHeader = ["id", "type", "inApp", "email", "digestMode"];
			const prefRows = notificationPrefs.map((p) => [
				p.id,
				p.type,
				p.inApp,
				p.email,
				p.digestMode,
			]);
			zip.file(
				"notification_preferences.csv",
				generateCsv(prefHeader, prefRows),
			);
		}

		const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
		return {
			zipData: zipBuffer.toString("base64"),
			filename: `user-data-${new Date().toISOString().slice(0, 10)}.zip`,
		};
	}
}
