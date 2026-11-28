/**
 * The totals the public project page shows (see loadPublicTotals), split out
 * of page-view.ts to keep that file under its size limit.
 */
import {
	fromMinor,
	sumMinor,
} from "@retrospend/domain/envelope/units";
import { roundedMinor } from "@retrospend/domain/money-minor";
import { db as globalDb } from "~/server/db";
import type { Money } from "~/server/figures/registry";
import { Prisma } from "~prisma";
import { byCategory, type CategoryInput } from "./page-figures";

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * What the public page shows of the whole project, from three aggregate
 * queries instead of every row: the count, the first day, the total and the
 * spending by category, per currency. Each row is rounded to its currency's
 * minor unit (half to even, roundedMinor) before it is summed, as the member
 * page does, so the two never differ by a cent. Rows with the same amount
 * form one group with a count, which keeps the query an aggregate: a
 * group's minor units are its count times one row's.
 *
 * Reads on the global client: the public page has no signed-in user, so
 * there is no RLS context, and the raw query below is refused on a scoped
 * client. The caller has checked the project is PUBLIC.
 */
export async function loadPublicTotals(projectId: string) {
	const where = { projectId };
	const [count, first] = await Promise.all([
		globalDb.sharedTransaction.count({ where }),
		globalDb.sharedTransaction.aggregate({ where, _min: { date: true } }),
	]);
	const groups = await globalDb.$queryRaw<
		{
			currency: string;
			categoryId: string | null;
			amount: string;
			rows: bigint;
		}[]
	>(Prisma.sql`
		SELECT t."currency",
			CASE WHEN category_shown_on_split(t."categoryId", t."id") THEN t."categoryId" END AS "categoryId",
			t."amount"::text AS "amount",
			COUNT(*) AS "rows"
		FROM "shared_transaction" t
		WHERE t."projectId" = ${projectId}
		GROUP BY t."currency", 2, t."amount"
	`);
	const ids = groups.flatMap((g) => (g.categoryId ? [g.categoryId] : []));
	const categories = ids.length
		? await globalDb.category.findMany({
				where: { id: { in: ids } },
				select: { id: true, name: true, icon: true, color: true },
			})
		: [];
	const byId = new Map(categories.map((c) => [c.id, c]));
	// Each row's rounded minor units, added per currency and category.
	const perGroup = new Map<
		string,
		{ currency: string; categoryId: string | null; minor: number[] }
	>();
	for (const g of groups) {
		const key = JSON.stringify([g.currency, g.categoryId]);
		const group = perGroup.get(key) ?? {
			currency: g.currency,
			categoryId: g.categoryId,
			minor: [],
		};
		group.minor.push(roundedMinor(g.amount, g.currency) * Number(g.rows));
		perGroup.set(key, group);
	}
	const perCurrency = new Map<string, number[]>();
	const inputs: CategoryInput[] = [...perGroup.values()].map((g) => {
		const minor = sumMinor(g.minor);
		const list = perCurrency.get(g.currency) ?? [];
		list.push(minor);
		perCurrency.set(g.currency, list);
		return {
			currency: g.currency,
			amount: fromMinor(minor, g.currency),
			category: g.categoryId ? (byId.get(g.categoryId) ?? null) : null,
			myShare: null,
		};
	});
	return {
		count,
		first: first._min.date ? day(first._min.date) : null,
		total: [...perCurrency.entries()]
			.map(
				([currency, parts]): Money => ({
					minor: sumMinor(parts),
					currency,
				}),
			)
			.sort((a, b) => (a.currency < b.currency ? -1 : 1)),
		byCategory: byCategory(inputs),
	};
}
