// Reads what retrospend_app may do, straight from the catalog of a migrated
// database. Shared by the privilege ratchet (privileges.pg.test.ts) and the
// rollback test (least-privilege-rollback.pg.test.ts), so both look at the
// same facts: table privileges, column privileges, sequence privileges, row
// level security and policies, and default privileges.

export type Queryable = {
	query<T extends Record<string, unknown>>(
		sql: string,
	): Promise<{ rows: T[] }>;
};

export type TableState = {
	/** Table-level privileges of retrospend_app, sorted. */
	privileges: string[];
	rls: boolean;
	forceRls: boolean;
	/** `name:COMMAND`, sorted. */
	policies: string[];
};

export type PrivilegeCatalog = {
	tables: Record<string, TableState>;
	/** Column-level privileges of retrospend_app: table -> privilege -> columns. */
	columns: Record<string, Record<string, string[]>>;
	/** Sequence privileges of retrospend_app, sorted. */
	sequences: Record<string, string[]>;
	/** Tables that PUBLIC holds any privilege on (must stay empty). */
	publicTables: string[];
};

const PRIVILEGES = [
	"DELETE",
	"INSERT",
	"REFERENCES",
	"SELECT",
	"TRIGGER",
	"TRUNCATE",
	"UPDATE",
] as const;

const COMMANDS: Record<string, string> = {
	r: "SELECT",
	a: "INSERT",
	w: "UPDATE",
	d: "DELETE",
	"*": "ALL",
};

export async function readPrivilegeCatalog(
	client: Queryable,
): Promise<PrivilegeCatalog> {
	const privilegeList = PRIVILEGES.map((p) => `'${p}'`).join(", ");
	const tableRows = await client.query<{
		name: string;
		privileges: string[];
		rls: boolean;
		force: boolean;
		policies: string[];
	}>(`
		SELECT c.relname AS name,
		       coalesce((
		         SELECT array_agg(p ORDER BY p)
		         FROM unnest(ARRAY[${privilegeList}]) p
		         WHERE has_table_privilege('retrospend_app', c.oid, p)
		       ), ARRAY[]::text[]) AS privileges,
		       c.relrowsecurity AS rls,
		       c.relforcerowsecurity AS force,
		       coalesce((
		         SELECT array_agg(pol.polname || ':' || pol.polcmd::text ORDER BY pol.polname)
		         FROM pg_policy pol WHERE pol.polrelid = c.oid
		       ), ARRAY[]::text[]) AS policies
		FROM pg_class c
		WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
		ORDER BY c.relname`);
	const tables: Record<string, TableState> = {};
	for (const row of tableRows.rows) {
		tables[row.name] = {
			privileges: row.privileges,
			rls: row.rls,
			forceRls: row.force,
			policies: row.policies.map((p) => {
				const [name, cmd] = p.split(":");
				return `${name}:${COMMANDS[cmd ?? ""] ?? cmd}`;
			}),
		};
	}

	const columnRows = await client.query<{
		table: string;
		column: string;
		privilege: string;
	}>(`
		SELECT c.relname AS "table", a.attname AS "column", p AS privilege
		FROM pg_attribute a
		JOIN pg_class c ON c.oid = a.attrelid
		CROSS JOIN unnest(ARRAY['INSERT', 'REFERENCES', 'SELECT', 'UPDATE']) p
		WHERE c.relnamespace = 'public'::regnamespace
		  AND c.relkind IN ('r', 'p')
		  AND a.attnum > 0 AND NOT a.attisdropped
		  AND a.attacl IS NOT NULL
		  AND EXISTS (
		    SELECT 1 FROM aclexplode(a.attacl) x
		    WHERE pg_get_userbyid(x.grantee) = 'retrospend_app' AND x.privilege_type = p
		  )
		ORDER BY 1, 3, 2`);
	const columns: PrivilegeCatalog["columns"] = {};
	for (const row of columnRows.rows) {
		const table = (columns[row.table] ??= {});
		(table[row.privilege] ??= []).push(row.column);
	}

	const sequenceRows = await client.query<{
		name: string;
		privileges: string[];
	}>(`
		SELECT c.relname AS name,
		       coalesce((
		         SELECT array_agg(p ORDER BY p)
		         FROM unnest(ARRAY['SELECT', 'UPDATE', 'USAGE']) p
		         WHERE has_sequence_privilege('retrospend_app', c.oid, p)
		       ), ARRAY[]::text[]) AS privileges
		FROM pg_class c
		WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
		ORDER BY c.relname`);
	const sequences: Record<string, string[]> = {};
	for (const row of sequenceRows.rows) sequences[row.name] = row.privileges;

	const publicRows = await client.query<{ name: string }>(`
		SELECT c.relname AS name
		FROM pg_class c
		WHERE c.relnamespace = 'public'::regnamespace
		  AND c.relkind IN ('r', 'p', 'S')
		  AND c.relacl IS NOT NULL
		  AND EXISTS (SELECT 1 FROM aclexplode(c.relacl) x WHERE x.grantee = 0)
		ORDER BY c.relname`);

	return {
		tables,
		columns,
		sequences,
		publicTables: publicRows.rows.map((r) => r.name),
	};
}

export type DefaultAcl = {
	role: string;
	/** `public`, or `all` for a default that is not limited to a schema. */
	schema: string;
	/** r tables, S sequences, f functions, T types, n schemas. */
	kind: string;
	/** Entries as `grantee:PRIVILEGE`, sorted; PUBLIC as `PUBLIC`. */
	entries: string[];
};

/** Every pg_default_acl row, with who it grants to. */
export async function readDefaultAcls(client: Queryable): Promise<DefaultAcl[]> {
	const rows = await client.query<{
		role: string;
		schema: string;
		kind: string;
		entries: string[];
	}>(`
		SELECT pg_get_userbyid(d.defaclrole)::text AS role,
		       CASE d.defaclnamespace WHEN 0 THEN 'all' ELSE d.defaclnamespace::regnamespace::text END AS schema,
		       d.defaclobjtype::text AS kind,
		       coalesce((
		         SELECT array_agg(
		                  CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END
		                    || ':' || a.privilege_type
		                  ORDER BY a.grantee, a.privilege_type)
		         FROM aclexplode(d.defaclacl) a
		       ), ARRAY[]::text[]) AS entries
		FROM pg_default_acl d
		ORDER BY 1, 2, 3`);
	return rows.rows;
}

/** Everything the least-privilege migration changes, as plain comparable text. */
export type CatalogSnapshot = {
	/** `table[.column] grantee PRIVILEGE`, for tables, columns and sequences. */
	acl: string[];
	/** `table rls=<bool> force=<bool>`. */
	security: string[];
	/** `table policy COMMAND using | check`. */
	policies: string[];
	/** Table and sequence default privileges, the role running the test as `<owner>`. */
	defaults: string[];
};

export async function readCatalogSnapshot(
	client: Queryable,
): Promise<CatalogSnapshot> {
	const lines = async (sql: string) =>
		(await client.query<{ line: string }>(sql)).rows.map((r) => r.line);
	const acl = await lines(`
		SELECT c.relname || ' ' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END
		       || ' ' || a.privilege_type || CASE WHEN a.is_grantable THEN '*' ELSE '' END AS line
		FROM pg_class c
		CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault((CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) a
		WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'S')
		UNION ALL
		SELECT c.relname || '.' || at.attname || ' ' || pg_get_userbyid(a.grantee)::text
		       || ' ' || a.privilege_type AS line
		FROM pg_attribute at
		JOIN pg_class c ON c.oid = at.attrelid
		CROSS JOIN LATERAL aclexplode(at.attacl) a
		WHERE c.relnamespace = 'public'::regnamespace AND at.attacl IS NOT NULL
		ORDER BY 1`);
	const security = await lines(`
		SELECT c.relname || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity AS line
		FROM pg_class c
		WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
		ORDER BY 1`);
	const policies = await lines(`
		SELECT c.relname || ' ' || p.polname || ' ' || p.polcmd::text || ' '
		       || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' | '
		       || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') AS line
		FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
		WHERE c.relnamespace = 'public'::regnamespace
		ORDER BY 1`);
	const owner =
		(await client.query<{ owner: string }>("SELECT current_user::text AS owner"))
			.rows[0]?.owner ?? "";
	const defaults = (await readDefaultAcls(client))
		.filter((d) => d.kind === "r" || d.kind === "S")
		.map((d) =>
			`${d.role} ${d.schema} ${d.kind} ${d.entries.join(",")}`.replaceAll(
				owner,
				"<owner>",
			),
		);
	// Sorted here, not by the database, so the order does not depend on its collation.
	return {
		acl: acl.sort(),
		security: security.sort(),
		policies: policies.sort(),
		defaults: defaults.sort(),
	};
}

/** A snapshot reduced to lines that name one of `tables` (defaults are kept). */
export function onlyTables(
	snapshot: CatalogSnapshot,
	tables: readonly string[],
): CatalogSnapshot {
	const names = new Set(tables);
	const mine = (line: string) => names.has(line.split(/[ .]/)[0] ?? "");
	return {
		acl: snapshot.acl.filter(mine),
		security: snapshot.security.filter(mine),
		policies: snapshot.policies.filter(mine),
		defaults: snapshot.defaults,
	};
}
