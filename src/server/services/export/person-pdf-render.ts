/**
 * The person summary PDF. It lays out text it is given: every amount
 * arrives already formatted by the export service and nothing here does
 * arithmetic.
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
	renderPdf,
	SECTION_GAP,
} from "./pdf-kit";

export interface PersonPdfData {
	/** IANA zone for the "Generated on" date (undefined = server zone). */
	timeZone?: string;
	personName: string;
	participantType: string;

	/** Open balances per currency; `amount` is the size, `direction` says who owes. */
	balances: Array<{
		currency: string;
		amount: string;
		direction: "they_owe_you" | "you_owe_them" | "settled";
	}>;

	relationshipStats: {
		transactionCount: number;
		projectCount: number;
		firstTransactionDate: string | null;
	};

	projectBreakdown: Array<{
		projectName: string | null;
		transactionCount: number;
	}>;

	categoryBreakdown: Array<{
		category: string;
		count: number;
		total: string;
		currency: string;
	}>;

	expenses: Array<{
		date: string;
		description: string;
		amount: string;
		currency: string;
		category: string;
		paidBy: string;
		yourShare: string;
		theirShare: string;
		project: string;
	}>;
}

function drawHeader(doc: PDFKit.PDFDocument, data: PersonPdfData): number {
	let y = MARGIN;
	doc
		.fontSize(FONT_SIZE_TITLE)
		.font("Helvetica-Bold")
		.fillColor(COLOR_PRIMARY)
		.text(`History with ${data.personName}`, MARGIN, y);
	y += FONT_SIZE_TITLE + 6;

	const metaParts: string[] = [];
	if (data.participantType !== "user") metaParts.push(data.participantType);
	if (data.relationshipStats.firstTransactionDate) {
		metaParts.push(`Since ${data.relationshipStats.firstTransactionDate}`);
	}
	metaParts.push(`${data.relationshipStats.transactionCount} expenses`);
	if (data.relationshipStats.projectCount > 0) {
		metaParts.push(`${data.relationshipStats.projectCount} projects`);
	}
	doc
		.fontSize(FONT_SIZE_BODY)
		.font("Helvetica")
		.fillColor(COLOR_SECONDARY)
		.text(metaParts.join("  |  "), MARGIN, y);
	return y + FONT_SIZE_BODY + 4 + SECTION_GAP;
}

const DIRECTION_TEXT = (data: PersonPdfData) => ({
	settled: "Settled",
	they_owe_you: `${data.personName} owes you`,
	you_owe_them: `You owe ${data.personName}`,
});

export async function generatePersonPdf(data: PersonPdfData): Promise<Buffer> {
	return renderPdf((doc) => {
		let y = drawHeader(doc, data);

		if (data.balances.length > 0) {
			const words = DIRECTION_TEXT(data);
			y = drawSectionHeader(doc, "Balance Summary", y);
			y = drawTable(
				doc,
				[
					{ header: "Currency", width: CONTENT_WIDTH * 0.3 },
					{ header: "Amount", width: CONTENT_WIDTH * 0.35, align: "right" },
					{ header: "Direction", width: CONTENT_WIDTH * 0.35 },
				],
				data.balances.map((b) => [b.currency, b.amount, words[b.direction]]),
				y,
			);
			y += SECTION_GAP;
		}

		if (data.projectBreakdown.length > 0) {
			y = drawSectionHeader(doc, "Project Breakdown", y);
			y = drawTable(
				doc,
				[
					{ header: "Project", width: CONTENT_WIDTH * 0.6 },
					{ header: "Expenses", width: CONTENT_WIDTH * 0.4, align: "right" },
				],
				data.projectBreakdown.map((p) => [
					p.projectName ?? "Standalone",
					String(p.transactionCount),
				]),
				y,
			);
			y += SECTION_GAP;
		}

		if (data.categoryBreakdown.length > 0) {
			y = drawSectionHeader(doc, "Category Breakdown", y);
			y = drawTable(
				doc,
				[
					{ header: "Category", width: CONTENT_WIDTH * 0.35 },
					{ header: "Count", width: CONTENT_WIDTH * 0.2, align: "right" },
					{ header: "Total", width: CONTENT_WIDTH * 0.25, align: "right" },
					{ header: "Currency", width: CONTENT_WIDTH * 0.2 },
				],
				data.categoryBreakdown.map((c) => [
					c.category,
					String(c.count),
					c.total,
					c.currency,
				]),
				y,
			);
			y += SECTION_GAP;
		}

		if (data.expenses.length > 0) {
			y = drawSectionHeader(doc, "Expenses", y);
			drawTable(
				doc,
				[
					{ header: "Date", width: CONTENT_WIDTH * 0.1 },
					{ header: "Description", width: CONTENT_WIDTH * 0.22 },
					{ header: "Amount", width: CONTENT_WIDTH * 0.12, align: "right" },
					{ header: "Cur", width: CONTENT_WIDTH * 0.07 },
					{ header: "Paid By", width: CONTENT_WIDTH * 0.14 },
					{ header: "Your Share", width: CONTENT_WIDTH * 0.12, align: "right" },
					{
						header: "Their Share",
						width: CONTENT_WIDTH * 0.12,
						align: "right",
					},
					{ header: "Project", width: CONTENT_WIDTH * 0.11 },
				],
				data.expenses.map((e) => [
					e.date,
					e.description,
					e.amount,
					e.currency,
					e.paidBy,
					e.yourShare,
					e.theirShare,
					e.project,
				]),
				y,
			);
		}

		addFooter(doc, data.timeZone);
	});
}
