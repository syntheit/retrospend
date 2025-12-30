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

const REQUIRED_COLUMNS = ["title", "amount", "currency", "date"] as const;

const splitCsvLine = (line: string): string[] => {
	const values: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i]!;

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

	const headerCells = splitCsvLine(lines[0]!).map((cell) =>
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
		const line = lines[i]!;
		if (!line.trim()) continue;

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
