/** Recurring templates. */
import { tableReads, tableWrites } from "./crud";
import type { Reader, TableRows, Writer } from "./port";

export type TemplateRow = TableRows["recurringTemplates"];

/**
 * The template columns that hold a person's free text. A src test holds this
 * list equal to the keys of FIELD_MAP.RecurringTemplate.columns, which the
 * engine cannot import.
 */
export const TEMPLATE_TEXT_COLUMNS = [
	"name",
	"websiteUrl",
	"paymentSource",
] as const;

/**
 * Columns that carry another table's text, joined on by the sync layer: the
 * category's name rides in `category`. A src test holds the join to FIELD_MAP.Category.
 */
export const TEMPLATE_JOINED_COLUMNS = ["category"] as const;

/**
 * Everything `templateWithoutText` drops: the owner of "what a device may keep
 * outside the store" for a template. The phone's outbox list is held equal to it.
 */
export const TEMPLATE_STRIPPED_COLUMNS = [
	...TEMPLATE_TEXT_COLUMNS,
	...TEMPLATE_JOINED_COLUMNS,
] as const;

export type TemplateStrippedColumn = (typeof TEMPLATE_STRIPPED_COLUMNS)[number];

/** The row as the device may hold it outside the store: no text and no joined category. */
export type TextFreeTemplateRow = Omit<TemplateRow, TemplateStrippedColumn>;

export function templateWithoutText(row: TemplateRow): TextFreeTemplateRow {
	const out: Record<string, unknown> = { ...row };
	for (const column of TEMPLATE_STRIPPED_COLUMNS) delete out[column];
	return out as TextFreeTemplateRow;
}

export const templateReads = (r: Reader) => tableReads(r, "recurringTemplates");

export function templateRepo(w: Writer) {
	const templates = tableWrites(w, "recurringTemplates");
	return {
		get: templates.get,
		list: templates.list,
		/** An existing id throws InvalidInputError. */
		create: templates.insert,
		/** A missing template throws NotFoundError. */
		update: templates.replace,
		remove: templates.remove,
		/**
		 * The template, and what the server's foreign keys do with it: its
		 * expenses keep their rows and lose the link, and a BILL envelope stops
		 * following it. True when the template existed.
		 */
		removeLinked(id: string): boolean {
			for (const e of w.list("expenses"))
				if (e.recurringTemplateId === id)
					w.put("expenses", { ...e, recurringTemplateId: null });
			for (const e of w.list("envelopes"))
				if (e.targetTemplateId === id)
					w.put("envelopes", { ...e, targetTemplateId: null });
			return templates.remove(id);
		},
	};
}
