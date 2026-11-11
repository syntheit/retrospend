/**
 * prisma/schema.prisma read as plain text, for tests that hold code in step
 * with the schema (the field map, the runtime model graph). Prisma 7's
 * prisma-client generator exposes no DMMF, and its runtime data model has no
 * `@id`, so the schema file is the source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./uiRules/paths";

export type SchemaField = {
	name: string;
	type: string;
	list: boolean;
	attributes: string;
};
export type SchemaModel = {
	name: string;
	table: string;
	fields: SchemaField[];
	/** Field names that make the primary key. */
	idFields: string[];
};

/** The models of prisma/schema.prisma: fields, `@@map` table and primary key. */
export function readSchema(): SchemaModel[] {
	const source = readFileSync(join(REPO_ROOT, "prisma", "schema.prisma"), "utf8");
	const models: SchemaModel[] = [];
	for (const match of source.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)) {
		const [, name = "", body = ""] = match;
		const fields: SchemaField[] = [];
		let table = name;
		let idFields: string[] = [];
		for (const raw of body.split("\n")) {
			const line = raw.trim();
			const map = line.match(/^@@map\("([^"]+)"\)/);
			if (map) table = map[1] ?? table;
			const composite = line.match(/^@@id\(\[([^\]]+)\]/);
			if (composite)
				idFields = (composite[1] ?? "").split(",").map((part) => part.trim());
			const field = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/);
			if (!field || line.startsWith("@@") || line.startsWith("//")) continue;
			const [, fieldName = "", type = "", list, , attributes = ""] = field;
			fields.push({ name: fieldName, type, list: Boolean(list), attributes });
			if (/(^|\s)@id(\s|\(|$)/.test(attributes)) idFields = [fieldName];
		}
		models.push({ name, table, fields, idFields });
	}
	return models;
}
