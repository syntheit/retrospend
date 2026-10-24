/**
 * The envelope budget as files a person can keep (budget build plan 02 §1
 * data management, P7): envelopes.csv, movements.csv, rules.json and
 * months.json. It replaces the old budgets.csv. Everything is read through
 * the caller's client, which is user-scoped (RLS), and written exactly as
 * stored: amounts are the stored decimals in the book currency, movements
 * are the append-only ledger with its undo rows, so the files rebuild every
 * figure the budget showed.
 */
import { generateCsv } from "~/lib/csv";
import type { EnvelopeExport } from "~/lib/schemas/envelope-migration";
import type { PrismaClient } from "~prisma";

type Db = Pick<
	PrismaClient,
	"budgetBook" | "budgetMovement" | "envelope" | "incomeRule" | "monthClose"
>;

const iso = (d: Date | null) => d?.toISOString() ?? "";
const text = (v: { toString(): string } | null) => v?.toString() ?? "";

const ENVELOPE_HEADER = [
	"id",
	"group",
	"name",
	"kind",
	"targetAmount",
	"targetCurrency",
	"targetMode",
	"targetCadence",
	"targetMonthlyAmount",
	"targetDueDate",
	"targetRepeat",
	"leftoverRule",
	"categories",
	"archivedAt",
	"createdAt",
];

const MOVEMENT_HEADER = [
	"id",
	"month",
	"kind",
	"amount",
	"currency",
	"fromEnvelope",
	"toEnvelope",
	"batchId",
	"revertsId",
	"ruleId",
	"sourceExpenseId",
	"note",
	"createdAt",
];

/** The files of the person's personal book; none without one. */
export async function envelopeExportFiles(
	db: Db,
	userId: string,
): Promise<EnvelopeExport["files"]> {
	const book = await db.budgetBook.findFirst({
		where: { createdById: userId, isPersonal: true },
		select: {
			id: true,
			currency: true,
			style: true,
			fundingSource: true,
			startMonth: true,
			monthStartDay: true,
			timeZone: true,
		},
	});
	if (!book) return [];
	const [envelopes, movements, rules, closes] = await Promise.all([
		db.envelope.findMany({
			where: { bookId: book.id },
			orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
			include: {
				group: { select: { name: true } },
				categories: { select: { category: { select: { name: true } } } },
			},
		}),
		db.budgetMovement.findMany({
			where: { bookId: book.id },
			orderBy: [{ createdAt: "asc" }, { id: "asc" }],
		}),
		db.incomeRule.findMany({
			where: { bookId: book.id },
			orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
		}),
		db.monthClose.findMany({
			where: { bookId: book.id },
			orderBy: { month: "asc" },
		}),
	]);
	const name = new Map(envelopes.map((e) => [e.id, e.name]));
	const envelopeCsv = generateCsv(
		ENVELOPE_HEADER,
		envelopes.map((e) => [
			e.id,
			e.group?.name,
			e.name,
			e.kind,
			text(e.targetAmount),
			e.targetCurrency ?? book.currency,
			e.targetMode,
			e.targetCadence,
			text(e.targetMonthlyAmount),
			e.targetDueDate?.toISOString().slice(0, 10),
			e.targetRepeat,
			e.leftoverRule,
			e.categories.map((c) => c.category.name).join("; "),
			iso(e.archivedAt),
			iso(e.createdAt),
		]),
	);
	const movementCsv = generateCsv(
		MOVEMENT_HEADER,
		movements.map((m) => [
			m.id,
			m.month,
			m.kind,
			text(m.amount),
			book.currency,
			m.fromEnvelopeId
				? (name.get(m.fromEnvelopeId) ?? m.fromEnvelopeId)
				: "To assign",
			m.toEnvelopeId
				? (name.get(m.toEnvelopeId) ?? m.toEnvelopeId)
				: "To assign",
			m.batchId,
			m.revertsId,
			m.ruleId,
			m.sourceExpenseId,
			m.note,
			iso(m.createdAt),
		]),
	);
	const rulesJson = {
		currency: book.currency,
		rules: rules.map((r) => ({
			id: r.id,
			name: r.name,
			order: r.sortOrder,
			match: { kind: r.matchKind, value: r.matchValue, title: r.matchTitle },
			action: r.action,
			value: text(r.value),
			envelope: name.get(r.envelopeId) ?? r.envelopeId,
			active: r.active,
			archivedAt: iso(r.archivedAt),
			createdAt: iso(r.createdAt),
		})),
	};
	const monthsJson = {
		book: {
			currency: book.currency,
			style: book.style,
			fundingSource: book.fundingSource,
			startMonth: book.startMonth,
			monthStartDay: book.monthStartDay,
			timeZone: book.timeZone,
		},
		months: closes.map((c) => ({
			month: c.month,
			mode: c.mode,
			closedAt: iso(c.closedAt),
			revision: c.revision,
			acknowledgedAt: iso(c.acknowledgedAt),
			summary: c.summary,
		})),
	};
	return [
		{ name: "envelopes.csv", contentType: "text/csv", content: envelopeCsv },
		{ name: "movements.csv", contentType: "text/csv", content: movementCsv },
		{
			name: "rules.json",
			contentType: "application/json",
			content: JSON.stringify(rulesJson, null, 2),
		},
		{
			name: "months.json",
			contentType: "application/json",
			content: JSON.stringify(monthsJson, null, 2),
		},
	];
}
