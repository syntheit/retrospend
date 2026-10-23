/**
 * import.commit (import.html "Import N"): writes the rows you kept as one
 * batch, each at its booked rate (bookImportRow), as the kind you chose,
 * and marks the job imported. It is a money mutation, so the Import sheet
 * previews this same write (R30), and its undo (import.undo) deletes the
 * whole batch.
 *
 * The rows' amounts, dates and currencies come from the job, never from the
 * client; the client sends only what the review decides per row (keep,
 * category, kind) and the currency override. Every row of the file lands in
 * exactly one count: created, already in Activity, unchecked, unreadable or
 * no rate, so the counts add up to the file's rows.
 */
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { Money } from "~/server/figures/registry";
import type { Prisma } from "~prisma";
import { dec, toMinor } from "../envelope/units";
import type { MoneyMutation } from "../preview/types";
import { loadRateContext } from "../rate-types";
import { bookImportRow, type ImportRate } from "./book";
import {
	existingKeys,
	isDuplicate,
	type PreparedRow,
	prepareRows,
} from "./prepare";
import { loadReviewableJob } from "./review";
import {
	categoryKindFor,
	IMPORT_KINDS,
	type ImportKind,
	kindColumns,
	type StoredRow,
	storedRows,
	unreadableCount,
} from "./rows";

type Tx = Prisma.TransactionClient;

export interface ImportChoice {
	readonly index: number;
	readonly keep: boolean;
	readonly categoryId: string | null;
	readonly kind: ImportKind;
}

export interface CommitImportInput {
	readonly jobId: string;
	readonly currency?: string | null;
	readonly rows: readonly ImportChoice[];
	readonly timeZone?: string;
}

export interface KindTotal {
	readonly kind: ImportKind;
	readonly count: number;
	/** The booked home values summed; null when none of them has one. */
	readonly total: Money | null;
	/** Created rows without a home value (no home rate yet), left out of total. */
	readonly withoutRate: number;
}

export interface ImportSummary {
	readonly jobId: string;
	readonly fileName: string;
	readonly fileRows: number;
	readonly created: number;
	readonly byKind: readonly KindTotal[];
	readonly duplicates: number;
	readonly unchecked: number;
	readonly unreadable: number;
	readonly noRate: number;
	/** The created rows' first and last day (YYYY-MM-DD), for View in Activity. */
	readonly from: string | null;
	readonly to: string | null;
}

type Created = { row: PreparedRow; kind: ImportKind; rate: ImportRate };

function choicesOf(input: CommitImportInput, size: number) {
	const map = new Map<number, ImportChoice>();
	for (const c of input.rows) {
		if (!Number.isInteger(c.index) || c.index < 0 || c.index >= size) {
			throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown row" });
		}
		map.set(c.index, c);
	}
	return map;
}

/** Your categories the choices name, each of the kind its row needs. */
async function checkedCategories(
	tx: Tx,
	userId: string,
	choices: Iterable<ImportChoice>,
) {
	const list = [...choices].filter((c) => c.keep && c.categoryId);
	const ids = [...new Set(list.map((c) => c.categoryId as string))];
	const found = await tx.category.findMany({
		where: { userId, id: { in: ids } },
		select: { id: true, kind: true, excludeByDefault: true },
	});
	const byId = new Map(found.map((c) => [c.id, c]));
	for (const c of list) {
		const category = byId.get(c.categoryId as string);
		if (!category || category.kind !== categoryKindFor(c.kind)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "A row has a category that does not fit its kind",
			});
		}
	}
	return byId;
}

function totals(created: readonly Created[]): KindTotal[] {
	return IMPORT_KINDS.flatMap((kind) => {
		const rows = created.filter((c) => c.kind === kind);
		if (rows.length === 0) return [];
		const booked = rows.flatMap((c) => (c.rate.home ? [c.rate.home] : []));
		const currency = booked[0]?.homeCurrency;
		const sum = booked.reduce((s, h) => s.add(dec(h.homeAmount)), dec(0));
		return [
			{
				kind,
				count: rows.length,
				total: currency ? { minor: toMinor(sum, currency), currency } : null,
				withoutRate: rows.length - booked.length,
			},
		];
	});
}

function rowData(
	userId: string,
	c: Created,
	choice: ImportChoice,
	excludeByDefault: boolean | undefined,
): Prisma.ExpenseCreateManyInput {
	const s: StoredRow = c.row.stored;
	return {
		id: randomUUID(),
		userId,
		title: c.row.title,
		amount: c.row.rate.amount,
		currency: c.row.rate.currency,
		date: c.row.date,
		categoryId: choice.categoryId,
		exchangeRate: c.rate.exchangeRate,
		amountInUSD: c.rate.amountInUSD,
		...(c.rate.home ?? {}),
		pricingSource: s.pricingSource || "IMPORT",
		location: s.location || null,
		description: s.description || null,
		// The file's column, else the category's default, else counted.
		excludeFromAnalytics: s.excludeFromAnalytics ?? excludeByDefault ?? false,
		status: "FINALIZED",
		...kindColumns(c.kind),
	};
}

export const commitImport: MoneyMutation<CommitImportInput, ImportSummary> = {
	id: "import.commit",
	touches: ["spent"],
	run: async (tx, input, actor) => {
		const userId = actor.userId;
		const job = await loadReviewableJob(tx, userId, input.jobId);
		const stored = storedRows(job.transactions);
		const { rows, badDates } = prepareRows(stored, input);
		const choices = choicesOf(input, stored.length);
		const [ctx, categories, keys] = await Promise.all([
			loadRateContext(tx, userId),
			checkedCategories(tx, userId, choices.values()),
			existingKeys(tx, userId, rows, input.timeZone),
		]);

		let duplicates = 0;
		let unchecked = 0;
		let noRate = 0;
		const created: Created[] = [];
		const data: Prisma.ExpenseCreateManyInput[] = [];
		const idOf = new Map<number, string>();
		for (const row of rows) {
			const choice = choices.get(row.index);
			const kind = choice?.kind ?? row.proposed;
			if (isDuplicate(keys, row, kind, input.timeZone)) duplicates++;
			else if (!choice?.keep) unchecked++;
			else {
				const rate = await bookImportRow(tx, ctx, row.rate);
				if (!rate) noRate++;
				else {
					const c = { row, kind, rate };
					const d = rowData(
						userId,
						c,
						choice,
						choice.categoryId
							? categories.get(choice.categoryId)?.excludeByDefault
							: undefined,
					);
					created.push(c);
					data.push(d);
					idOf.set(row.index, d.id as string);
				}
			}
		}
		if (data.length > 0) await tx.expense.createMany({ data });

		const transactions = stored.map((s, i) => {
			const { expenseId: _old, ...rest } = s;
			const id = idOf.get(i);
			return id ? { ...rest, expenseId: id } : rest;
		});
		await tx.importJob.update({
			where: { id: job.id },
			data: {
				status: "COMPLETED",
				completedAt: new Date(),
				importedCount: data.length,
				skippedDuplicates: duplicates,
				transactions: transactions as unknown as Prisma.InputJsonValue,
			},
		});

		const days = created.map((c) => c.row.day).sort();
		return {
			value: {
				jobId: job.id,
				fileName: job.fileName,
				fileRows: stored.length + unreadableCount(job.warnings),
				created: data.length,
				byKind: totals(created),
				duplicates,
				unchecked,
				unreadable: unreadableCount(job.warnings) + badDates,
				noRate,
				from: days[0] ?? null,
				to: days.at(-1) ?? null,
			},
			undo: {
				kind: "revert",
				mutation: "import.commit",
				rows: [{ table: "import_job", id: job.id }],
			},
		};
	},
};
