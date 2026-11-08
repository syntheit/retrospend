// Helpers shared by the pg tests of the owner role (src/test/migrations/owner-*.pg.test.ts).
import { Client } from "pg";
import { migratorRoleName } from "../../../scripts/db-owner/index.mjs";

export async function connect(url: string) {
	const client = new Client({ connectionString: url });
	await client.connect();
	return client;
}

/**
 * Whether the owner holds CREATE on the database `superUrl` names, asked on a
 * connection of its own as the superuser (so it can be asked mid-migration).
 */
export async function ownerCanCreateIn(superUrl: string): Promise<boolean> {
	const client = await connect(superUrl);
	try {
		const { rows } = await client.query<{ can: boolean }>(
			"SELECT has_database_privilege('retrospend_owner', current_database(), 'CREATE') AS can",
		);
		return rows[0]?.can === true;
	} finally {
		await client.end();
	}
}

/** The name of the database a URL points at. */
export const databaseOf = (url: string) =>
	decodeURIComponent(new URL(url).pathname.slice(1));

/** Whether the one-shot migration role of the database `superUrl` names exists. */
export async function migratorExists(superUrl: string): Promise<boolean> {
	const client = await connect(superUrl);
	try {
		const { rows } = await client.query(
			"SELECT 1 FROM pg_roles WHERE rolname = $1",
			[migratorRoleName(databaseOf(superUrl))],
		);
		return rows.length > 0;
	} finally {
		await client.end();
	}
}

/**
 * A session of the owner that keeps trying, until stopped, for what the
 * migrations hold during a brand-new install's window: CREATE on the database
 * (and with it a schema, and a trusted extension whose script runs as the
 * superuser). Every attempt that is not refused is a win for the attacker.
 */
export function raceForCreate(session: Client) {
	let attempts = 0;
	const wins: string[] = [];
	let stop = false;
	const loop = (async () => {
		while (!stop) {
			attempts++;
			for (const sql of [
				"CREATE SCHEMA a2_zz",
				"CREATE EXTENSION hstore WITH SCHEMA a2_zz",
				"CREATE EXTENSION hstore",
				"SELECT 1 WHERE has_database_privilege(current_user, current_database(), 'CREATE')",
			]) {
				try {
					const result = await session.query(sql);
					if (result.command !== "SELECT" || result.rowCount) wins.push(sql);
				} catch {
					// refused
				}
			}
		}
	})();
	return {
		finish: async () => {
			stop = true;
			await loop;
			return { attempts, wins };
		},
	};
}

/** Every object in public or keystore that retrospend_owner does not own, extension members excepted. */
const FOREIGN_OWNED = `
	WITH owner AS (SELECT oid FROM pg_roles WHERE rolname = 'retrospend_owner'),
	     schemas AS (SELECT oid, nspname FROM pg_namespace WHERE nspname IN ('public', 'keystore'))
	SELECT 'schema ' || nspname AS object
	  FROM pg_namespace WHERE oid IN (SELECT oid FROM schemas)
	   AND nspowner <> (SELECT oid FROM owner)
	UNION ALL
	SELECT 'relation ' || c.oid::regclass || ' (' || c.relkind::text || ')'
	  FROM pg_class c WHERE c.relnamespace IN (SELECT oid FROM schemas)
	   AND c.relowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
	UNION ALL
	SELECT 'routine ' || p.oid::regprocedure
	  FROM pg_proc p WHERE p.pronamespace IN (SELECT oid FROM schemas)
	   AND p.proowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
	UNION ALL
	SELECT 'type ' || t.oid::regtype
	  FROM pg_type t WHERE t.typnamespace IN (SELECT oid FROM schemas)
	   AND t.typowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
	UNION ALL
	SELECT 'collation ' || o.collname FROM pg_collation o
	 WHERE o.collnamespace IN (SELECT oid FROM schemas) AND o.collowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_collation'::regclass AND d.objid = o.oid AND d.deptype = 'e')
	UNION ALL
	SELECT 'conversion ' || o.conname FROM pg_conversion o
	 WHERE o.connamespace IN (SELECT oid FROM schemas) AND o.conowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_conversion'::regclass AND d.objid = o.oid AND d.deptype = 'e')
	UNION ALL
	SELECT 'operator ' || o.oprname FROM pg_operator o
	 WHERE o.oprnamespace IN (SELECT oid FROM schemas) AND o.oprowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_operator'::regclass AND d.objid = o.oid AND d.deptype = 'e')
	UNION ALL
	SELECT 'operator class ' || o.opcname FROM pg_opclass o
	 WHERE o.opcnamespace IN (SELECT oid FROM schemas) AND o.opcowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_opclass'::regclass AND d.objid = o.oid AND d.deptype = 'e')
	UNION ALL
	SELECT 'operator family ' || o.opfname FROM pg_opfamily o
	 WHERE o.opfnamespace IN (SELECT oid FROM schemas) AND o.opfowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_opfamily'::regclass AND d.objid = o.oid AND d.deptype = 'e')
	UNION ALL
	SELECT 'text search configuration ' || o.cfgname FROM pg_ts_config o
	 WHERE o.cfgnamespace IN (SELECT oid FROM schemas) AND o.cfgowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_ts_config'::regclass AND d.objid = o.oid AND d.deptype = 'e')
	UNION ALL
	SELECT 'text search dictionary ' || o.dictname FROM pg_ts_dict o
	 WHERE o.dictnamespace IN (SELECT oid FROM schemas) AND o.dictowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_ts_dict'::regclass AND d.objid = o.oid AND d.deptype = 'e')
	UNION ALL
	SELECT 'statistics ' || o.stxname FROM pg_statistic_ext o
	 WHERE o.stxnamespace IN (SELECT oid FROM schemas) AND o.stxowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_statistic_ext'::regclass AND d.objid = o.oid AND d.deptype = 'e')
	ORDER BY 1`;

export async function foreignOwned(client: Client): Promise<string[]> {
	const { rows } = await client.query<{ object: string }>(FOREIGN_OWNED);
	return rows.map((r) => r.object);
}

/** Runs a statement that cannot be in a transaction block, and returns the error it raised. */
export async function failureOutsideTransaction(
	client: Client,
	sql: string,
): Promise<string | null> {
	try {
		await client.query(sql);
		return null;
	} catch (error) {
		return (error as Error).message;
	}
}

/** Runs `sql` in a transaction that is rolled back, and returns the error it raised. */
export async function failureOf(
	client: Client,
	sql: string,
): Promise<string | null> {
	await client.query("BEGIN");
	try {
		await client.query(sql);
		return null;
	} catch (error) {
		return (error as Error).message;
	} finally {
		await client.query("ROLLBACK");
	}
}
