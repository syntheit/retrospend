/**
 * The project summary PDF. It lays out text it is given: every amount
 * arrives already formatted by the export service, one string per currency
 * (currencies are never added together), and nothing here does arithmetic.
 */
import {
	addFooter,
	COLOR_PRIMARY,
	COLOR_SECONDARY,
	CONTENT_WIDTH,
	drawSectionHeader,
	drawTable,
	FONT_SIZE_BODY,
	FONT_SIZE_TITLE,
	MARGIN,
	MARGIN_BOTTOM,
	PAGE_HEIGHT,
	ROW_HEIGHT,
	renderPdf,
	SECTION_GAP,
	type TableColumn,
} from "./pdf-kit";

export interface ProjectPdfData {
	/** IANA zone for the "Generated on" date (undefined = server zone). */
	timeZone?: string;
	projectName: string;
	status: string;
	primaryCurrency: string;
	description: string | null;
	periodLabel: string | null;

	participants: Array<{ name: string; role: string }>;

	/** "1234.50 ARS", one per currency. */
	totals: string[];
	expenseCount: number;
	/** "5000000.00 ARS", or null without a budget. */
	budget: string | null;

	categoryBreakdown: Array<{
		category: string;
		count: number;
		currency: string;
		total: string;
	}>;

	/** One row per member and currency (omit for SOLO). */
	balances: Array<{
		name: string;
		currency: string;
		paid: string;
		fairShare: string;
		net: string;
	}>;

	/** Settlement plan rows (omit for SOLO) */
	settlements: Array<{
		from: string;
		to: string;
		amount: string;
		currency: string;
	}>;

	expenses: Array<{
		date: string;
		description: string;
		amount: string;
		currency: string;
		category: string;
		paidBy: string;
	}>;
}

const manyCurrencies = (rows: ReadonlyArray<{ currency: string }>) =>
	new Set(rows.map((r) => r.currency)).size > 1;

function drawHeader(doc: PDFKit.PDFDocument, data: ProjectPdfData): number {
	let y = MARGIN;
	doc
		.fontSize(FONT_SIZE_TITLE)
		.font("Helvetica-Bold")
		.fillColor(COLOR_PRIMARY)
		.text(data.projectName, MARGIN, y);
	y += FONT_SIZE_TITLE + 6;

	const metaParts: string[] = [];
	if (data.status !== "ACTIVE") metaParts.push(data.status);
	metaParts.push(data.primaryCurrency);
	if (data.periodLabel) metaParts.push(`Period: ${data.periodLabel}`);
	doc
		.fontSize(FONT_SIZE_BODY)
		.font("Helvetica")
		.fillColor(COLOR_SECONDARY)
		.text(metaParts.join("  |  "), MARGIN, y);
	y += FONT_SIZE_BODY + 4;

	if (data.description) {
		doc
			.fontSize(FONT_SIZE_BODY)
			.font("Helvetica")
			.fillColor(COLOR_SECONDARY)
			.text(data.description, MARGIN, y, { width: CONTENT_WIDTH });
		y += doc.heightOfString(data.description, { width: CONTENT_WIDTH }) + 4;
	}
	return y + SECTION_GAP;
}

function drawSummary(
	doc: PDFKit.PDFDocument,
	data: ProjectPdfData,
	startY: number,
): number {
	let y = drawSectionHeader(doc, "Summary", startY);
	const lines = [
		`Total Spent: ${data.totals.join("; ")}`,
		`Expenses: ${data.expenseCount}`,
	];
	if (data.budget !== null) lines.push(`Budget: ${data.budget}`);
	for (const line of lines) {
		if (y + ROW_HEIGHT > PAGE_HEIGHT - MARGIN_BOTTOM) {
			doc.addPage();
			y = MARGIN;
		}
		doc
			.fontSize(FONT_SIZE_BODY)
			.font("Helvetica")
			.fillColor(COLOR_PRIMARY)
			.text(line, MARGIN, y);
		y += 14;
	}
	return y + SECTION_GAP - 14;
}

function drawCategories(
	doc: PDFKit.PDFDocument,
	data: ProjectPdfData,
	startY: number,
): number {
	const rows = data.categoryBreakdown;
	const y = drawSectionHeader(doc, "Category Breakdown", startY);
	const many = manyCurrencies(rows);
	const columns: TableColumn[] = many
		? [
				{ header: "Category", width: CONTENT_WIDTH * 0.35 },
				{ header: "Count", width: CONTENT_WIDTH * 0.15, align: "right" },
				{ header: "Total", width: CONTENT_WIDTH * 0.3, align: "right" },
				{ header: "Currency", width: CONTENT_WIDTH * 0.2 },
			]
		: [
				{ header: "Category", width: CONTENT_WIDTH * 0.45 },
				{ header: "Count", width: CONTENT_WIDTH * 0.2, align: "right" },
				{
					header: `Total (${rows[0]?.currency ?? data.primaryCurrency})`,
					width: CONTENT_WIDTH * 0.35,
					align: "right",
				},
			];
	const end = drawTable(
		doc,
		columns,
		rows.map((c) => [
			c.category,
			String(c.count),
			c.total,
			...(many ? [c.currency] : []),
		]),
		y,
	);
	return end + SECTION_GAP;
}

function drawBalances(
	doc: PDFKit.PDFDocument,
	data: ProjectPdfData,
	startY: number,
): number {
	const rows = data.balances;
	const y = drawSectionHeader(doc, "Participant Balances", startY);
	const many = manyCurrencies(rows);
	const share = many ? 0.22 : 0.25;
	const columns: TableColumn[] = [
		{ header: "Name", width: CONTENT_WIDTH * (many ? 0.2 : 0.25) },
		...(many ? [{ header: "Currency", width: CONTENT_WIDTH * 0.12 }] : []),
		{ header: "Paid", width: CONTENT_WIDTH * share, align: "right" },
		{
			header: "Fair Share",
			width: CONTENT_WIDTH * (many ? 0.23 : 0.25),
			align: "right",
		},
		{
			header: "Net Balance",
			width: CONTENT_WIDTH * (many ? 0.23 : 0.25),
			align: "right",
		},
	];
	const end = drawTable(
		doc,
		columns,
		rows.map((b) => [
			b.name,
			...(many ? [b.currency] : []),
			b.paid,
			b.fairShare,
			b.net,
		]),
		y,
	);
	return end + SECTION_GAP;
}

export async function generateProjectPdf(
	data: ProjectPdfData,
): Promise<Buffer> {
	return renderPdf((doc) => {
		let y = drawHeader(doc, data);

		if (data.participants.length > 0) {
			y = drawSectionHeader(doc, "Participants", y);
			y = drawTable(
				doc,
				[
					{ header: "Name", width: CONTENT_WIDTH * 0.6 },
					{ header: "Role", width: CONTENT_WIDTH * 0.4 },
				],
				data.participants.map((p) => [p.name, p.role]),
				y,
			);
			y += SECTION_GAP;
		}

		y = drawSummary(doc, data, y);
		if (data.categoryBreakdown.length > 0) y = drawCategories(doc, data, y);
		if (data.balances.length > 0) y = drawBalances(doc, data, y);

		if (data.settlements.length > 0) {
			y = drawSectionHeader(doc, "Settlement Plan", y);
			y = drawTable(
				doc,
				[
					{ header: "From", width: CONTENT_WIDTH * 0.3 },
					{ header: "To", width: CONTENT_WIDTH * 0.3 },
					{ header: "Amount", width: CONTENT_WIDTH * 0.2, align: "right" },
					{ header: "Currency", width: CONTENT_WIDTH * 0.2 },
				],
				data.settlements.map((s) => [s.from, s.to, s.amount, s.currency]),
				y,
			);
			y += SECTION_GAP;
		}

		if (data.expenses.length > 0) {
			y = drawSectionHeader(doc, "Expenses", y);
			drawTable(
				doc,
				[
					{ header: "Date", width: CONTENT_WIDTH * 0.12 },
					{ header: "Description", width: CONTENT_WIDTH * 0.28 },
					{ header: "Amount", width: CONTENT_WIDTH * 0.14, align: "right" },
					{ header: "Currency", width: CONTENT_WIDTH * 0.1 },
					{ header: "Category", width: CONTENT_WIDTH * 0.18 },
					{ header: "Paid By", width: CONTENT_WIDTH * 0.18 },
				],
				data.expenses.map((e) => [
					e.date,
					e.description,
					e.amount,
					e.currency,
					e.category,
					e.paidBy,
				]),
				y,
			);
		}

		addFooter(doc, data.timeZone);
	});
}
