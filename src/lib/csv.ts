import { parseDateOnly } from "./date";

export type ParsedCsvRow = {
	title: string;
	amount: number;
	currency: string;
	date: Date;
	exchangeRate?: number;
	amountInUSD?: number;
	location?: string | null;
	description?: string | null;
	categoryName?: string | null;
	pricingSource?: string | null;
};

export type ParsedBudgetRow = {
	categoryName?: string;
	amount: number;
	period: Date;
	isRollover: boolean;
	rolloverAmount: number;
	pegToActual: boolean;
};

export type ParsedWealthRow = {
	name: string;
	type: string;
	currency: string;
	balance: number;
	isLiquid: boolean;
	interestRate?: number;
	minimumPayment?: number;
	dueDate?: number;
};

const REQUIRED_COLUMNS = ["title", "amount", "currency", "date"] as const;

const splitCsvLine = (line: string): string[] => {
	const values: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i] ?? "";

		if (char === '"') {
			if (inQuotes && line[i + 1] === '"') {
				// Escaped quote
				current += '"';
				i++; // Skip next quote
			} else {
				inQuotes = !inQuotes;
			}
		} else if (char === "," && !inQuotes) {
			values.push(current);
			current = "";
		} else {
			current += char;
		}
	}

	values.push(current);
	return values;
};

const normalizeNumber = (value: string): number | undefined => {
	if (!value.trim()) return undefined;
	const num = parseFloat(value.trim());
	return Number.isNaN(num) ? undefined : num;
};

export const parseCsv = (text: string) => {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0);

	if (lines.length === 0) {
		return { rows: [] as ParsedCsvRow[], errors: ["The CSV file is empty."] };
	}

	const headerCells = splitCsvLine(lines[0] ?? "").map((cell) =>
		cell.trim().toLowerCase(),
	);
	const headerMap = new Map<string, number>(
		headerCells.map((cell, index) => [cell.toLowerCase(), index]),
	);

	const missing = REQUIRED_COLUMNS.filter((col) => !headerMap.has(col));
	if (missing.length > 0) {
		return {
			rows: [] as ParsedCsvRow[],
			errors: [
				`Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
			],
		};
	}

	const rows: ParsedCsvRow[] = [];
	const errors: string[] = [];

	const readCell = (cells: string[], col: string): string => {
		const idx = headerMap.get(col.toLowerCase());
		return typeof idx === "number" ? (cells[idx]?.trim() ?? "") : "";
	};

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line || !line.trim()) continue;

		const cells = splitCsvLine(line);
		const title = readCell(cells, "title");
		const amount = normalizeNumber(readCell(cells, "amount"));
		const currency = readCell(cells, "currency").toUpperCase();
		const dateString = readCell(cells, "date");
		const exchangeRate = normalizeNumber(readCell(cells, "exchangerate"));
		const amountInUSD = normalizeNumber(readCell(cells, "amountinusd"));
		const location = readCell(cells, "location") || null;
		const description = readCell(cells, "description") || null;
		const categoryName = readCell(cells, "category") || null;
		const pricingSource = readCell(cells, "pricingsource") || undefined;

		if (!title) {
			errors.push(`Row ${i + 1}: title is required.`);
			continue;
		}

		if (!amount || amount <= 0) {
			errors.push(`Row ${i + 1}: amount must be a positive number.`);
			continue;
		}

		if (!currency || currency.length !== 3) {
			errors.push(`Row ${i + 1}: currency must be a 3-letter code.`);
			continue;
		}

		let parsedDate: Date;
		try {
			parsedDate = parseDateOnly(dateString);
		} catch (_error) {
			errors.push(`Row ${i + 1}: date is invalid. Use YYYY-MM-DD format.`);
			continue;
		}

		if (!exchangeRate && !amountInUSD && currency !== "USD") {
			errors.push(
				`Row ${i + 1}: provide exchangeRate or amountInUSD (or use USD currency).`,
			);
			continue;
		}

		rows.push({
			title,
			amount,
			currency,
			date: parsedDate,
			exchangeRate,
			amountInUSD,
			location,
			description,
			categoryName,
			pricingSource,
		});
	}

	return { rows, errors };
};

export const parseBudgetCsv = (text: string) => {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0);

	if (lines.length === 0) {
		return {
			rows: [] as ParsedBudgetRow[],
			errors: ["The CSV file is empty."],
		};
	}

	const headerCells = splitCsvLine(lines[0] ?? "").map((cell) =>
		cell.trim().toLowerCase(),
	);
	const headerMap = new Map<string, number>(
		headerCells.map((cell, index) => [cell.toLowerCase(), index]),
	);

	// "period" is preferred, but "date" is acceptable
	const periodIndex = headerMap.get("period") ?? headerMap.get("date");
	const amountIndex = headerMap.get("amount");

	if (periodIndex === undefined || amountIndex === undefined) {
		return {
			rows: [],
			errors: ["Missing required columns: amount, period (or date)."],
		};
	}

	const rows: ParsedBudgetRow[] = [];
	const errors: string[] = [];

	const readCell = (cells: string[], col: string): string => {
		const idx = headerMap.get(col.toLowerCase());
		return typeof idx === "number" ? (cells[idx]?.trim() ?? "") : "";
	};

	const parseBoolean = (val: string): boolean => {
		const v = val.toLowerCase();
		return v === "true" || v === "yes" || v === "1";
	};

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line || !line.trim()) continue;

		const cells = splitCsvLine(line);
		const categoryName = readCell(cells, "categoryName") || undefined;
		const amount = normalizeNumber(readCell(cells, "amount"));
		// try period, fallback to date
		const periodString = readCell(cells, "period") || readCell(cells, "date");
		const isRollover = parseBoolean(readCell(cells, "isRollover"));
		const rolloverAmount =
			normalizeNumber(readCell(cells, "rolloverAmount")) ?? 0;
		const pegToActual = parseBoolean(readCell(cells, "pegToActual"));

		if (amount === undefined || amount < 0) {
			errors.push(`Row ${i + 1}: amount must be a non-negative number.`);
			continue;
		}

		let period: Date;
		try {
			period = parseDateOnly(periodString);
		} catch (_error) {
			errors.push(`Row ${i + 1}: period/date is invalid.`);
			continue;
		}

		rows.push({
			categoryName,
			amount,
			period,
			isRollover,
			rolloverAmount,
			pegToActual,
		});
	}

	return { rows, errors };
};

export const parseWealthCsv = (text: string) => {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0);

	if (lines.length === 0) {
		return {
			rows: [] as ParsedWealthRow[],
			errors: ["The CSV file is empty."],
		};
	}

	const headerCells = splitCsvLine(lines[0] ?? "").map((cell) =>
		cell.trim().toLowerCase(),
	);
	const headerMap = new Map<string, number>(
		headerCells.map((cell, index) => [cell.toLowerCase(), index]),
	);

	const nameIndex = headerMap.get("name");
	const balanceIndex = headerMap.get("balance");
	const currencyIndex = headerMap.get("currency");
	const typeIndex = headerMap.get("type");

	if (
		nameIndex === undefined ||
		balanceIndex === undefined ||
		currencyIndex === undefined ||
		typeIndex === undefined
	) {
		return {
			rows: [],
			errors: ["Missing required columns: name, balance, currency, type."],
		};
	}

	const rows: ParsedWealthRow[] = [];
	const errors: string[] = [];

	const readCell = (cells: string[], col: string): string => {
		const idx = headerMap.get(col.toLowerCase());
		return typeof idx === "number" ? (cells[idx]?.trim() ?? "") : "";
	};

	const parseBoolean = (val: string): boolean => {
		const v = val.toLowerCase();
		return v === "true" || v === "yes" || v === "1";
	};

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line || !line.trim()) continue;

		const cells = splitCsvLine(line);
		const name = readCell(cells, "name");
		const balance = normalizeNumber(readCell(cells, "balance"));
		const currency = readCell(cells, "currency").toUpperCase();
		const type = readCell(cells, "type").toUpperCase();
		const isLiquid = parseBoolean(readCell(cells, "isLiquid"));
		const interestRate = normalizeNumber(readCell(cells, "interestRate"));
		const minimumPayment = normalizeNumber(readCell(cells, "minimumPayment"));
		const dueDate = normalizeNumber(readCell(cells, "dueDate"));

		if (!name) {
			errors.push(`Row ${i + 1}: name is required.`);
			continue;
		}

		if (balance === undefined) {
			errors.push(`Row ${i + 1}: balance is required.`);
			continue;
		}

		if (!currency || currency.length !== 3) {
			errors.push(`Row ${i + 1}: currency must be a 3-letter code.`);
			continue;
		}

		if (!type) {
			errors.push(`Row ${i + 1}: type is required.`);
			continue;
		}

		rows.push({
			name,
			balance,
			currency,
			type,
			isLiquid,
			interestRate,
			minimumPayment,
			dueDate,
		});
	}

	return { rows, errors };
};

/**
 * Escapes a value for use in a CSV file.
 * Handles null/undefined, Dates, numbers, and strings with special characters.
 */
export function escapeValue(raw: unknown): string {
	if (raw === null || raw === undefined) return "";

	const value =
		raw instanceof Date
			? (raw.toISOString().split("T")[0] ?? "")
			: typeof raw === "number" || typeof raw === "bigint"
				? raw.toString()
				: String(raw);

	const needsEscaping = /["\n,]/.test(value);
	if (!needsEscaping) return value;

	// Escape double quotes by doubling them and wrapping the entire value in quotes
	return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Generates a complete CSV string from headers and raw data.
 */
export function generateCsv(headers: string[], rows: unknown[][]): string {
	const csvRows = [
		headers.join(","),
		...rows.map((row) => row.map((cell) => escapeValue(cell)).join(",")),
	];
	return csvRows.join("\n");
}
