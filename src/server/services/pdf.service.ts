import PDFDocument from "pdfkit";

// ── Types ───────────────────────────────────────────────────────────────────

export interface PersonPdfData {
	personName: string;
	participantType: string;

	/** Net balances per currency */
	balances: Array<{
		currency: string;
		amount: number;
		direction: "they_owe_you" | "you_owe_them" | "settled";
	}>;

	relationshipStats: {
		transactionCount: number;
		projectCount: number;
		firstTransactionDate: string | null;
	};

	/** Per-project breakdown */
	projectBreakdown: Array<{
		projectName: string | null;
		transactionCount: number;
	}>;

	categoryBreakdown: Array<{
		category: string;
		count: number;
		total: number;
		currency: string;
	}>;

	expenses: Array<{
		date: string;
		description: string;
		amount: number;
		currency: string;
		category: string;
		paidBy: string;
		yourShare: number;
		theirShare: number;
		project: string;
	}>;
}

export interface ProjectPdfData {
	projectName: string;
	projectType: string;
	status: string;
	startDate: string | null;
	endDate: string | null;
	primaryCurrency: string;
	description: string | null;
	periodLabel: string | null;

	participants: Array<{ name: string; role: string }>;

	totalSpent: number;
	expenseCount: number;
	budgetAmount: number | null;

	categoryBreakdown: Array<{
		category: string;
		count: number;
		total: number;
	}>;

	/** Participant balance rows (omit for SOLO) */
	balances: Array<{
		name: string;
		paid: number;
		fairShare: number;
		net: number;
	}>;

	/** Settlement plan rows (omit for SOLO) */
	settlements: Array<{
		from: string;
		to: string;
		amount: number;
		currency: string;
	}>;

	expenses: Array<{
		date: string;
		description: string;
		amount: number;
		currency: string;
		category: string;
		paidBy: string;
	}>;
}

// ── Constants ───────────────────────────────────────────────────────────────

const MARGIN = 50;
const MARGIN_BOTTOM = 70; // extra space reserved for footer
const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FONT_SIZE_TITLE = 20;
const FONT_SIZE_SECTION = 13;
const FONT_SIZE_BODY = 9;
const FONT_SIZE_SMALL = 8;
const ROW_HEIGHT = 18;
const HEADER_ROW_HEIGHT = 20;
const SECTION_GAP = 24;
const COLOR_PRIMARY = "#1a1a1a";
const COLOR_SECONDARY = "#666666";
const COLOR_HEADER_BG = "#f5f5f5";
const COLOR_BORDER = "#e0e0e0";

// ── Helpers ─────────────────────────────────────────────────────────────────

function drawSectionHeader(doc: PDFKit.PDFDocument, title: string, y: number): number {
	doc
		.fontSize(FONT_SIZE_SECTION)
		.font("Helvetica-Bold")
		.fillColor(COLOR_PRIMARY)
		.text(title, MARGIN, y);
	const lineY = y + FONT_SIZE_SECTION + 4;
	doc
		.moveTo(MARGIN, lineY)
		.lineTo(MARGIN + CONTENT_WIDTH, lineY)
		.strokeColor(COLOR_BORDER)
		.lineWidth(0.5)
		.stroke();
	return lineY + 8;
}

interface TableColumn {
	header: string;
	width: number;
	align?: "left" | "right" | "center";
}

function drawTable(
	doc: PDFKit.PDFDocument,
	columns: TableColumn[],
	rows: string[][],
	startY: number,
): number {
	let y = startY;

	// Header row
	if (y + HEADER_ROW_HEIGHT > PAGE_HEIGHT - MARGIN_BOTTOM) {
		doc.addPage();
		y = MARGIN;
	}

	doc
		.rect(MARGIN, y, CONTENT_WIDTH, HEADER_ROW_HEIGHT)
		.fill(COLOR_HEADER_BG);

	let x = MARGIN;
	for (const col of columns) {
		doc
			.fontSize(FONT_SIZE_SMALL)
			.font("Helvetica-Bold")
			.fillColor(COLOR_PRIMARY)
			.text(col.header, x + 4, y + 5, {
				width: col.width - 8,
				align: col.align ?? "left",
				lineBreak: false,
			});
		x += col.width;
	}

	y += HEADER_ROW_HEIGHT;

	// Data rows
	for (const row of rows) {
		if (y + ROW_HEIGHT > PAGE_HEIGHT - MARGIN_BOTTOM) {
			doc.addPage();
			y = MARGIN;
		}

		// Subtle border
		doc
			.moveTo(MARGIN, y + ROW_HEIGHT)
			.lineTo(MARGIN + CONTENT_WIDTH, y + ROW_HEIGHT)
			.strokeColor(COLOR_BORDER)
			.lineWidth(0.25)
			.stroke();

		x = MARGIN;
		for (let i = 0; i < columns.length; i++) {
			const col = columns[i]!;
			const cellText = row[i] ?? "";
			doc
				.fontSize(FONT_SIZE_BODY)
				.font("Helvetica")
				.fillColor(COLOR_PRIMARY)
				.text(cellText, x + 4, y + 4, {
					width: col.width - 8,
					align: col.align ?? "left",
					lineBreak: false,
				});
			x += col.width;
		}

		y += ROW_HEIGHT;
	}

	return y;
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function generateProjectPdf(
	data: ProjectPdfData,
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const doc = new PDFDocument({
			size: "A4",
			margins: { top: MARGIN, bottom: MARGIN_BOTTOM, left: MARGIN, right: MARGIN },
			bufferPages: true,
		});

		const chunks: Buffer[] = [];
		doc.on("data", (chunk: Buffer) => chunks.push(chunk));
		doc.on("end", () => resolve(Buffer.concat(chunks)));
		doc.on("error", reject);

		let y = MARGIN;

		// ── 1. Header ────────────────────────────────────────────────────────

		doc
			.fontSize(FONT_SIZE_TITLE)
			.font("Helvetica-Bold")
			.fillColor(COLOR_PRIMARY)
			.text(data.projectName, MARGIN, y);
		y += FONT_SIZE_TITLE + 6;

		const metaParts: string[] = [];
		if (data.projectType) metaParts.push(data.projectType);
		if (data.status !== "ACTIVE") metaParts.push(data.status);
		if (data.startDate && data.endDate) {
			metaParts.push(`${data.startDate} to ${data.endDate}`);
		} else if (data.startDate) {
			metaParts.push(`From ${data.startDate}`);
		} else if (data.endDate) {
			metaParts.push(`Until ${data.endDate}`);
		}
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

		y += SECTION_GAP;

		// ── 2. Participants ──────────────────────────────────────────────────

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

		// ── 3. Summary ───────────────────────────────────────────────────────

		y = drawSectionHeader(doc, "Summary", y);
		const summaryLines = [
			`Total Spent: ${data.totalSpent.toFixed(2)} ${data.primaryCurrency}`,
			`Expenses: ${data.expenseCount}`,
		];
		if (data.budgetAmount !== null) {
			summaryLines.push(
				`Budget: ${data.budgetAmount.toFixed(2)} ${data.primaryCurrency}`,
			);
		}
		for (const line of summaryLines) {
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
		y += SECTION_GAP - 14;

		// ── 4. Category Breakdown ────────────────────────────────────────────

		if (data.categoryBreakdown.length > 0) {
			y = drawSectionHeader(doc, "Category Breakdown", y);
			y = drawTable(
				doc,
				[
					{ header: "Category", width: CONTENT_WIDTH * 0.45 },
					{ header: "Count", width: CONTENT_WIDTH * 0.2, align: "right" },
					{
						header: `Total (${data.primaryCurrency})`,
						width: CONTENT_WIDTH * 0.35,
						align: "right",
					},
				],
				data.categoryBreakdown.map((c) => [
					c.category,
					String(c.count),
					c.total.toFixed(2),
				]),
				y,
			);
			y += SECTION_GAP;
		}

		// ── 5. Participant Balances (skip for SOLO) ──────────────────────────

		if (data.balances.length > 0) {
			y = drawSectionHeader(doc, "Participant Balances", y);
			y = drawTable(
				doc,
				[
					{ header: "Name", width: CONTENT_WIDTH * 0.25 },
					{ header: "Paid", width: CONTENT_WIDTH * 0.25, align: "right" },
					{
						header: "Fair Share",
						width: CONTENT_WIDTH * 0.25,
						align: "right",
					},
					{
						header: "Net Balance",
						width: CONTENT_WIDTH * 0.25,
						align: "right",
					},
				],
				data.balances.map((b) => [
					b.name,
					b.paid.toFixed(2),
					b.fairShare.toFixed(2),
					(b.net >= 0 ? "+" : "") + b.net.toFixed(2),
				]),
				y,
			);
			y += SECTION_GAP;
		}

		// ── 6. Settlement Plan (skip for SOLO) ──────────────────────────────

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
				data.settlements.map((s) => [
					s.from,
					s.to,
					s.amount.toFixed(2),
					s.currency,
				]),
				y,
			);
			y += SECTION_GAP;
		}

		// ── 7. Expenses ─────────────────────────────────────────────────────

		if (data.expenses.length > 0) {
			y = drawSectionHeader(doc, "Expenses", y);
			y = drawTable(
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
					e.amount.toFixed(2),
					e.currency,
					e.category,
					e.paidBy,
				]),
				y,
			);
		}

		// ── Footer ──────────────────────────────────────────────────────────
		// Temporarily zero out the bottom margin on each page so doc.text()
		// doesn't trigger auto-pagination when writing in the footer area.

		const pageRange = doc.bufferedPageRange();
		const footerY = PAGE_HEIGHT - MARGIN_BOTTOM + 20;

		for (let i = 0; i < pageRange.count; i++) {
			doc.switchToPage(i);
			const savedBottom = doc.page.margins.bottom;
			doc.page.margins.bottom = 0;
			doc
				.fontSize(7)
				.font("Helvetica")
				.fillColor(COLOR_SECONDARY)
				.text(
					`Generated by Retrospend on ${new Date().toISOString().slice(0, 10)}  |  Page ${i + 1} of ${pageRange.count}`,
					MARGIN,
					footerY,
					{ width: CONTENT_WIDTH, align: "center", lineBreak: false },
				);
			doc.page.margins.bottom = savedBottom;
		}

		doc.end();
	});
}

// ── Person PDF ──────────────────────────────────────────────────────────────

function addFooter(doc: PDFKit.PDFDocument) {
	const pageRange = doc.bufferedPageRange();
	const footerY = PAGE_HEIGHT - MARGIN_BOTTOM + 20;
	for (let i = 0; i < pageRange.count; i++) {
		doc.switchToPage(i);
		const savedBottom = doc.page.margins.bottom;
		doc.page.margins.bottom = 0;
		doc
			.fontSize(7)
			.font("Helvetica")
			.fillColor(COLOR_SECONDARY)
			.text(
				`Generated by Retrospend on ${new Date().toISOString().slice(0, 10)}  |  Page ${i + 1} of ${pageRange.count}`,
				MARGIN,
				footerY,
				{ width: CONTENT_WIDTH, align: "center", lineBreak: false },
			);
		doc.page.margins.bottom = savedBottom;
	}
}

export async function generatePersonPdf(
	data: PersonPdfData,
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const doc = new PDFDocument({
			size: "A4",
			margins: { top: MARGIN, bottom: MARGIN_BOTTOM, left: MARGIN, right: MARGIN },
			bufferPages: true,
		});

		const chunks: Buffer[] = [];
		doc.on("data", (chunk: Buffer) => chunks.push(chunk));
		doc.on("end", () => resolve(Buffer.concat(chunks)));
		doc.on("error", reject);

		let y = MARGIN;

		// ── 1. Header ────────────────────────────────────────────────────────

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
		y += FONT_SIZE_BODY + 4;

		y += SECTION_GAP;

		// ── 2. Balance Summary ───────────────────────────────────────────────

		if (data.balances.length > 0) {
			y = drawSectionHeader(doc, "Balance Summary", y);
			y = drawTable(
				doc,
				[
					{ header: "Currency", width: CONTENT_WIDTH * 0.3 },
					{ header: "Amount", width: CONTENT_WIDTH * 0.35, align: "right" },
					{ header: "Direction", width: CONTENT_WIDTH * 0.35 },
				],
				data.balances.map((b) => [
					b.currency,
					Math.abs(b.amount).toFixed(2),
					b.direction === "settled"
						? "Settled"
						: b.direction === "they_owe_you"
							? `${data.personName} owes you`
							: `You owe ${data.personName}`,
				]),
				y,
			);
			y += SECTION_GAP;
		}

		// ── 3. Project Breakdown ─────────────────────────────────────────────

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

		// ── 4. Category Breakdown ────────────────────────────────────────────

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
					c.total.toFixed(2),
					c.currency,
				]),
				y,
			);
			y += SECTION_GAP;
		}

		// ── 5. Expenses ─────────────────────────────────────────────────────

		if (data.expenses.length > 0) {
			y = drawSectionHeader(doc, "Expenses", y);
			y = drawTable(
				doc,
				[
					{ header: "Date", width: CONTENT_WIDTH * 0.1 },
					{ header: "Description", width: CONTENT_WIDTH * 0.22 },
					{ header: "Amount", width: CONTENT_WIDTH * 0.12, align: "right" },
					{ header: "Cur", width: CONTENT_WIDTH * 0.07 },
					{ header: "Paid By", width: CONTENT_WIDTH * 0.14 },
					{ header: "Your Share", width: CONTENT_WIDTH * 0.12, align: "right" },
					{ header: "Their Share", width: CONTENT_WIDTH * 0.12, align: "right" },
					{ header: "Project", width: CONTENT_WIDTH * 0.11 },
				],
				data.expenses.map((e) => [
					e.date,
					e.description,
					e.amount.toFixed(2),
					e.currency,
					e.paidBy,
					e.yourShare.toFixed(2),
					e.theirShare.toFixed(2),
					e.project,
				]),
				y,
			);
		}

		// ── Footer ──────────────────────────────────────────────────────────

		addFooter(doc);
		doc.end();
	});
}
