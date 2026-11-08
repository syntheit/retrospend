// SECURITY DEFINER hygiene (access hardening plan, PR 3). The function list
// comes from the migrated database's catalog, not from reading migrations, so
// a function added by any migration is checked: it must not be executable by
// PUBLIC, must pin a search_path that ends in pg_temp, and must be listed in
// definer-functions.json with the right answer for retrospend_app.
import { describe, expect, it } from "vitest";
import { adminDb } from "~/test/pg-harness";
import lists from "./definer-functions.json";

type FunctionRow = {
	name: string;
	definer: boolean;
	publicExecute: boolean;
	appExecute: boolean;
	searchPath: string | null;
};

// Extension functions (unaccent) are not ours and keep their own grants.
async function publicFunctions(): Promise<FunctionRow[]> {
	return adminDb.$queryRaw<FunctionRow[]>`
		SELECT p.proname AS name,
		       p.prosecdef AS definer,
		       (p.proacl IS NULL OR EXISTS (
		         SELECT 1 FROM aclexplode(p.proacl) a
		         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
		       )) AS "publicExecute",
		       has_function_privilege('retrospend_app', p.oid, 'EXECUTE') AS "appExecute",
		       (SELECT split_part(c, '=', 2) FROM unnest(p.proconfig) c
		         WHERE c LIKE 'search_path=%') AS "searchPath"
		FROM pg_proc p
		WHERE p.pronamespace = 'public'::regnamespace
		  AND p.prokind IN ('f', 'p')
		  AND NOT EXISTS (
		    SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
		  )
		ORDER BY p.proname`;
}

async function definerFunctions(): Promise<FunctionRow[]> {
	return (await publicFunctions()).filter((f) => f.definer);
}

type Tx = Parameters<Parameters<typeof adminDb.$transaction>[0]>[0];

/** Runs one statement as retrospend_app in its own transaction. */
async function asApp(run: (tx: Tx) => Promise<unknown>) {
	return adminDb.$transaction(async (tx) => {
		await tx.$executeRaw`SET LOCAL ROLE retrospend_app`;
		return run(tx);
	});
}

describe("SECURITY DEFINER functions in public", () => {
	it("finds the functions the lists name", async () => {
		const names = (await definerFunctions()).map((f) => f.name);
		expect(names.length).toBeGreaterThan(40);
		expect(new Set(names).size).toBe(names.length);
	});

	it("none is executable by PUBLIC", async () => {
		const open = (await definerFunctions())
			.filter((f) => f.publicExecute)
			.map((f) => f.name);
		expect(open).toEqual([]);
	});

	it("every one is in exactly one list", async () => {
		const names = (await definerFunctions()).map((f) => f.name);
		const listed = [...lists.appExecutable, ...lists.ownerOnly];
		expect(new Set(listed).size).toBe(listed.length);
		expect([...names].sort()).toEqual([...listed].sort());
	});

	it("retrospend_app executes exactly the appExecutable ones", async () => {
		const rows = await definerFunctions();
		expect(
			rows
				.filter((f) => f.appExecute)
				.map((f) => f.name)
				.sort(),
		).toEqual([...lists.appExecutable].sort());
	});

	it("every search_path ends in pg_temp", async () => {
		const bad = (await definerFunctions())
			.filter((f) => !f.searchPath || !/pg_temp\s*$/.test(f.searchPath))
			.map((f) => `${f.name}: ${f.searchPath}`);
		expect(bad).toEqual([]);
	});
});

describe("SECURITY INVOKER functions in public", () => {
	it("none is executable by PUBLIC", async () => {
		const open = (await publicFunctions())
			.filter((f) => !f.definer && f.publicExecute)
			.map((f) => f.name);
		expect(open).toEqual([]);
	});

	it("retrospend_app executes exactly the invokerAppExecutable ones", async () => {
		const rows = (await publicFunctions()).filter((f) => !f.definer);
		expect(
			rows
				.filter((f) => f.appExecute)
				.map((f) => f.name)
				.sort(),
		).toEqual([...lists.invokerAppExecutable].sort());
	});
});

describe("function defaults and the public schema", () => {
	it("new functions are not executable by PUBLIC, for every role with defaults", async () => {
		const rows = await adminDb.$queryRaw<{ role: string; revoked: boolean }[]>`
			SELECT pg_get_userbyid(r.role_oid)::text AS role,
			       EXISTS (
			         SELECT 1 FROM pg_default_acl d
			         WHERE d.defaclrole = r.role_oid AND d.defaclobjtype = 'f'
			           AND d.defaclnamespace = 0
			           AND NOT EXISTS (
			             SELECT 1 FROM aclexplode(d.defaclacl) a WHERE a.grantee = 0
			           )
			       ) AS revoked
			FROM (
			  SELECT DISTINCT defaclrole AS role_oid FROM pg_default_acl
			  UNION SELECT (SELECT oid FROM pg_roles WHERE rolname = current_user)
			) r`;
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.filter((r) => !r.revoked)).toEqual([]);
	});

	it("PUBLIC cannot create objects in public", async () => {
		const [row] = await adminDb.$queryRaw<{ open: boolean }[]>`
			SELECT EXISTS (
			  SELECT 1 FROM pg_namespace n, aclexplode(n.nspacl) a
			  WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE'
			) AS open`;
		expect(row?.open).toBe(false);
	});
});

describe("retrospend_app and the owner-only functions", () => {
	const denied = /permission denied for function/;

	it("cannot call budget_party_user, which returns any shadow's claimedById", async () => {
		await expect(
			asApp((tx) => tx.$queryRaw`SELECT budget_party_user('shadow', 'someone')`),
		).rejects.toThrow(denied);
	});

	it("cannot call budget_dirty_add for a book of its choosing", async () => {
		await expect(
			asApp(
				(tx) => tx.$queryRaw`SELECT budget_dirty_add('someone-elses-book', 0)`,
			),
		).rejects.toThrow(denied);
	});

	it("cannot call budget_dirty_user for a user of its choosing", async () => {
		await expect(
			asApp((tx) => tx.$queryRaw`SELECT budget_dirty_user('someone', NULL)`),
		).rejects.toThrow(denied);
	});

	it("cannot call payment_tx_note_put, which the settlement guards trust", async () => {
		await expect(
			asApp(
				(tx) =>
					tx.$queryRaw`SELECT payment_tx_note_put('pay', 'tx', '{}'::jsonb)`,
			),
		).rejects.toThrow(denied);
	});

	it("still calls a helper its policies use", async () => {
		await expect(
			asApp(
				(tx) => tx.$queryRaw`SELECT is_budget_member('none', 'nobody') AS m`,
			),
		).resolves.toEqual([{ m: false }]);
	});
});
