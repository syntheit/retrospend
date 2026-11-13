/**
 * The rows of a Retrospend CSV as import rows (the queue's reader for CSV and
 * spreadsheet jobs): each row is checked and priced, and a row that cannot be
 * read is skipped with a warning that names it ("Row 3: ..."). Moved out of
 * import-queue.service.ts unchanged.
 */
import { formatDateOnly, parseDateOnly } from "~/lib/date";
import {
	computeAmountInUSD,
	isValidRate,
	roundUSD,
	USD,
} from "@retrospend/domain/money";
import type { Prisma, PrismaClient } from "~prisma";
import { findExchangeRate } from "../../exchange-rates";
import type { ImporterTransaction } from "../import-queue.service";

export async function readCsvRows(
	db: PrismaClient | Prisma.TransactionClient,
	rawRows: Record<string, string>[],
	additionalWarnings: string[],
): Promise<{ transactions: ImporterTransaction[]; warnings: string[] }> {
	const transactions: ImporterTransaction[] = [];
	const warnings: string[] = [...additionalWarnings];

	for (let i = 0; i < rawRows.length; i++) {
		const row = rawRows[i]!;

		try {
			// Extract and validate required fields
			const title = row.title?.trim();
			const amountStr = row.amount?.trim();
			const currency = row.currency?.trim().toUpperCase();
			const dateStr = row.date?.trim();

			if (!title) {
				warnings.push(`Row ${i + 1}: Missing title, skipping`);
				continue;
			}

			if (!amountStr) {
				warnings.push(`Row ${i + 1}: Missing amount, skipping`);
				continue;
			}

			const amount = parseFloat(amountStr);
			if (isNaN(amount) || amount <= 0) {
				warnings.push(`Row ${i + 1}: Invalid amount "${amountStr}", skipping`);
				continue;
			}

			if (!currency || !/^[A-Z0-9]{3,10}$/.test(currency)) {
				warnings.push(`Row ${i + 1}: Invalid currency "${currency}", skipping`);
				continue;
			}

			if (!dateStr) {
				warnings.push(`Row ${i + 1}: Missing date, skipping`);
				continue;
			}

			let date: Date;
			try {
				date = parseDateOnly(dateStr);
			} catch {
				warnings.push(`Row ${i + 1}: Invalid date "${dateStr}", skipping`);
				continue;
			}

			// Extract optional fields
			const exchangeRateStr = row.exchangerate?.trim();
			const amountInUSDStr = row.amountinusd?.trim();
			const location = row.location?.trim() || "";
			const description = row.description?.trim() || "";
			const category = row.category?.trim() || "";
			const pricingSource = row.pricingsource?.trim() || "IMPORT";
			const excludeCell = row.excludefromanalytics?.trim().toLowerCase();
			const excludeFromAnalytics =
				excludeCell === undefined || excludeCell === ""
					? undefined
					: ["true", "yes", "1"].includes(excludeCell);

			// Calculate exchange rate and USD amount. Rates use the stored
			// convention (fiat: units per USD, crypto: USD per coin).
			let exchangeRate: number | undefined;
			let amountInUSD: number;
			let fromTable = false;
			if (currency === USD) {
				exchangeRate = 1;
				amountInUSD = roundUSD(amount);
			} else if (exchangeRateStr) {
				exchangeRate = parseFloat(exchangeRateStr);
				if (!isValidRate(exchangeRate)) {
					warnings.push(
						`Row ${i + 1}: Invalid exchange rate "${exchangeRateStr}", skipping`,
					);
					continue;
				}
				amountInUSD = computeAmountInUSD(amount, currency, exchangeRate);
			} else if (amountInUSDStr) {
				amountInUSD = parseFloat(amountInUSDStr);
				if (!isValidRate(amountInUSD)) {
					warnings.push(
						`Row ${i + 1}: Invalid USD amount "${amountInUSDStr}", skipping`,
					);
					continue;
				}
				// Kept as the file has it, with no rate: booking prices the row
				// at exactly USD / amount (book.ts, csv.service.ts), where a
				// float rate here would move a cent on a tie.
			} else {
				const picked = await findExchangeRate(db, currency, date);
				if (!picked) {
					warnings.push(
						`Row ${i + 1}: No exchange rate or USD amount for ${currency}, skipping`,
					);
					continue;
				}
				exchangeRate = picked.rate;
				amountInUSD = computeAmountInUSD(amount, currency, exchangeRate);
				fromTable = true;
			}

			transactions.push({
				title,
				amount,
				currency,
				...(exchangeRate === undefined ? {} : { exchangeRate }),
				amountInUSD,
				date: formatDateOnly(date),
				location,
				description,
				pricingSource,
				category,
				...(excludeFromAnalytics === undefined ? {} : { excludeFromAnalytics }),
				...(row.kind?.trim() ? { kind: row.kind.trim() } : {}),
				...(fromTable ? { rateSource: "table" as const } : {}),
			});
		} catch (error) {
			warnings.push(
				`Row ${i + 1}: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}
	return { transactions, warnings };
}
