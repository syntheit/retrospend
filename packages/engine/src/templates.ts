/** Recurring templates. */
import { tableReads, tableWrites } from "./crud";
import type { Reader, TableRows, Writer } from "./port";

export type TemplateRow = TableRows["recurringTemplates"];

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
	};
}
