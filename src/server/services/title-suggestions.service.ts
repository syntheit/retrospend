/**
 * Autocomplete for the expense title field: personal expense titles and
 * shared transactions the user is in, grouped case-insensitively and ordered
 * by use, each with the category and amount it was last used with.
 */
import type { PrismaClient } from "~prisma";
import { listedEntryWhere } from "./spending";

export async function titleSuggestions(
	db: PrismaClient,
	userId: string,
	query: string,
) {
	const [expenseGroups, sharedGroups] = await Promise.all([
		db.expense.groupBy({
			by: ["title"],
			where: {
				...listedEntryWhere(userId),
				title: { contains: query, mode: "insensitive" },
			},
			_count: { title: true },
			orderBy: { _count: { title: "desc" } },
			take: 15,
		}),
		db.sharedTransaction.groupBy({
			by: ["description"],
			where: {
				description: { contains: query, mode: "insensitive" },
				splitParticipants: {
					some: { participantType: "user", participantId: userId },
				},
			},
			_count: { description: true },
			orderBy: { _count: { description: "desc" } },
			take: 15,
		}),
	]);

	// Merge counts by title (case-insensitive), preserving canonical casing
	const countMap = new Map<string, number>();
	const canonicalTitle = new Map<string, string>();
	for (const g of expenseGroups) {
		const key = g.title.toLowerCase();
		if (!canonicalTitle.has(key)) canonicalTitle.set(key, g.title);
		countMap.set(key, (countMap.get(key) ?? 0) + g._count.title);
	}
	for (const g of sharedGroups) {
		const key = g.description.toLowerCase();
		if (!canonicalTitle.has(key)) canonicalTitle.set(key, g.description);
		countMap.set(key, (countMap.get(key) ?? 0) + g._count.description);
	}

	const sorted = [...countMap.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 8);

	if (sorted.length === 0) return [];

	// Get the most recent expense's categoryId for each top title
	const topTitles = sorted.map(([key]) => canonicalTitle.get(key) ?? key);
	const recentExpenses = await db.expense.findMany({
		where: { ...listedEntryWhere(userId), title: { in: topTitles } },
		orderBy: { date: "desc" },
		select: { title: true, categoryId: true, amount: true, currency: true },
		distinct: ["title"],
	});

	const categoryByTitle = new Map<string, string | null>();
	const amountByTitle = new Map<string, { amount: number; currency: string }>();
	for (const e of recentExpenses) {
		const key = e.title.toLowerCase();
		if (!categoryByTitle.has(key)) categoryByTitle.set(key, e.categoryId);
		if (!amountByTitle.has(key))
			amountByTitle.set(key, {
				amount: Number(e.amount),
				currency: e.currency,
			});
	}

	return sorted.map(([lowKey, count]) => ({
		title: canonicalTitle.get(lowKey) ?? lowKey,
		count,
		lastCategoryId: categoryByTitle.get(lowKey) ?? null,
		lastAmount: amountByTitle.get(lowKey)?.amount ?? null,
		lastCurrency: amountByTitle.get(lowKey)?.currency ?? null,
	}));
}
