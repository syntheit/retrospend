import { randomBytes } from "node:crypto";
import type { Client } from "pg";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	inject,
	it,
	vi,
} from "vitest";
import { migratorRoleName } from "../../scripts/db-owner/index.mjs";
import { connect } from "./db-owner/helpers";
import {
	createMarkedTemplate,
	markedRuns,
	markRun,
	migratorRolesByLiveness,
	migratorRolesInUse,
	RunLock,
	removeRun,
	runNames,
	sweepDeadRuns,
	tryLockRun,
	unlockRun,
} from "./pg-run-sweep";

// Fixture runs carry a marker of their own, with this run's stem in it: the
// sweep of any other run (this cluster is shared) never sees them, and this
// file's sweeps never see another worktree's fixtures. The migration roles
// are not put into retrospend_app, which owner-role.pg.test.ts counts.
const { stem: ownStem, maintenanceUrl } = inject("pgRun");
const MARKER = `retrospend pg sweep fixture ${ownStem} `;
const quiet = { log: () => undefined, marker: MARKER };

let admin: Client;
const holders: Client[] = [];

// Creating and dropping databases takes seconds on a busy cluster.
const SLOW = 60_000;
vi.setConfig({ testTimeout: SLOW, hookTimeout: SLOW });

beforeEach(async () => {
	admin = await connect(maintenanceUrl);
});

afterEach(async () => {
	for (const holder of holders.splice(0)) await holder.end().catch(() => {});
	await sweepDeadRuns(admin, maintenanceUrl, quiet);
	await admin.end();
});

const fixtureStem = () =>
	`retrospend_test_fx_${randomBytes(4).toString("hex")}`;

const exists = async (name: string) =>
	(await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]))
		.rowCount === 1;

const roleExists = async (name: string) =>
	(await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [name]))
		.rowCount === 1;

/**
 * A run killed mid-migration: its databases, its marker, and the migration
 * role of the template and of the scratch database, holding CREATE on its
 * database and owning a table in it.
 */
async function killedRun(stem: string, marker = true) {
	const names = runNames(stem, 1);
	const databases = [names.template, names.scratch, names.workers[0] as string];
	for (const name of databases) await admin.query(`CREATE DATABASE "${name}"`);
	if (marker) await markRun(admin, stem, MARKER);
	const roles = [names.template, names.scratch].map(migratorRoleName);
	for (const [index, role] of roles.entries()) {
		const database = databases[index] as string;
		await admin.query(
			`CREATE ROLE "${role}" LOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB`,
		);
		await admin.query(`GRANT CREATE ON DATABASE "${database}" TO "${role}"`);
		const inside = await connect(
			maintenanceUrl.replace(/\/postgres(\?|$)/, `/${database}$1`),
		);
		try {
			await inside.query("CREATE TABLE public.leftover (id integer)");
			await inside.query(`ALTER TABLE public.leftover OWNER TO "${role}"`);
		} finally {
			await inside.end();
		}
	}
	return { databases, roles };
}

/** A session that holds the run's lock, as the process of a live run does. */
async function liveSession(stem: string) {
	const session = await connect(maintenanceUrl);
	holders.push(session);
	expect(await tryLockRun(session, stem)).toBe(true);
	return session;
}

describe("sweepDeadRuns", () => {
	it("removes the databases and the migration roles of a run whose session ended", async () => {
		const stem = fixtureStem();
		const session = await liveSession(stem);
		const { databases, roles } = await killedRun(stem);
		await session.end();

		expect(await sweepDeadRuns(admin, maintenanceUrl, quiet)).toEqual([stem]);

		for (const name of databases) expect(await exists(name)).toBe(false);
		for (const role of roles) expect(await roleExists(role)).toBe(false);
	});

	it("leaves a run that holds its lock, its databases and its migration roles alone", async () => {
		const stem = fixtureStem();
		await liveSession(stem);
		const { databases, roles } = await killedRun(stem);

		expect(await sweepDeadRuns(admin, maintenanceUrl, quiet)).toEqual([]);

		for (const name of databases) expect(await exists(name)).toBe(true);
		for (const role of roles) expect(await roleExists(role)).toBe(true);
		expect(await markedRuns(admin, MARKER)).toEqual([stem]);
	});

	it("removes the run once its lock is released, and not before", async () => {
		const stem = fixtureStem();
		const session = await liveSession(stem);
		const { databases, roles } = await killedRun(stem);
		expect(await sweepDeadRuns(admin, maintenanceUrl, quiet)).toEqual([]);
		await unlockRun(session, stem);

		expect(await sweepDeadRuns(admin, maintenanceUrl, quiet)).toEqual([stem]);

		for (const name of databases) expect(await exists(name)).toBe(false);
		for (const role of roles) expect(await roleExists(role)).toBe(false);
	});

	it("never touches databases that carry no marker, whoever holds the lock", async () => {
		const stem = fixtureStem();
		const { databases, roles } = await killedRun(stem, false);
		try {
			expect(await sweepDeadRuns(admin, maintenanceUrl, quiet)).toEqual([]);
			for (const name of databases) expect(await exists(name)).toBe(true);
			for (const role of roles) expect(await roleExists(role)).toBe(true);
		} finally {
			for (const name of databases) {
				await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
			}
			for (const role of roles) {
				await admin.query(`DROP ROLE IF EXISTS "${role}"`);
			}
		}
	});

	it("keeps the template, with its marker, when a role cannot be removed, so the next sweep finds the run again", async () => {
		const stem = fixtureStem();
		const { roles } = await killedRun(stem);
		// A role that owns something in a database outside the run cannot be
		// dropped: the removal fails after the other databases are gone.
		const outside = `retrospend_test_fx_outside_${randomBytes(4).toString("hex")}`;
		await admin.query(`CREATE DATABASE "${outside}"`);
		try {
			const inside = await connect(
				maintenanceUrl.replace(/\/postgres(\?|$)/, `/${outside}$1`),
			);
			try {
				await inside.query("CREATE TABLE public.stray (id integer)");
				await inside.query(`ALTER TABLE public.stray OWNER TO "${roles[0]}"`);
			} finally {
				await inside.end();
			}
			const logged: string[] = [];
			const removed = await sweepDeadRuns(admin, maintenanceUrl, {
				marker: MARKER,
				log: (message) => logged.push(message),
			});
			expect(removed).toEqual([]);
			expect(logged).toHaveLength(1);
			expect(await exists(runNames(stem, 1).template)).toBe(true);
			expect(await exists(runNames(stem, 1).scratch)).toBe(false);
			expect(await markedRuns(admin, MARKER)).toEqual([stem]);
		} finally {
			await admin.query(`DROP DATABASE IF EXISTS "${outside}" WITH (FORCE)`);
		}
	});
});

describe("a run that draws the stem of a dead run", () => {
	it("sweeps the dead run's leftovers on the lock it holds, and keeps the lock", async () => {
		const stem = fixtureStem();
		// The new run holds the lock (claimRun) before the sweep: advisory locks
		// are reentrant in a session, so the sweep takes it a second time.
		const session = await liveSession(stem);
		const { databases, roles } = await killedRun(stem);

		expect(await sweepDeadRuns(session, maintenanceUrl, quiet)).toEqual([stem]);

		for (const name of databases) expect(await exists(name)).toBe(false);
		for (const role of roles) expect(await roleExists(role)).toBe(false);
		// The sweep gave back its own hold and nothing more.
		expect(await tryLockRun(admin, stem)).toBe(false);
	});
});

describe("RunLock", () => {
	const open = async (stem: string) => {
		const lock = new RunLock(maintenanceUrl);
		await lock.connect();
		holders.push(lock.client);
		expect(await lock.take(stem)).toBe(true);
		return lock;
	};

	it("passes while the session holds the lock", async () => {
		const stem = fixtureStem();
		const lock = await open(stem);
		await expect(lock.assertHeld(stem)).resolves.toBeUndefined();
	});

	it("refuses once the connection is gone, as the run's lock went with it", async () => {
		const stem = fixtureStem();
		const lock = await open(stem);
		const { rows } = await lock.client.query<{ pid: number }>(
			"SELECT pg_backend_pid() AS pid",
		);
		await admin.query("SELECT pg_terminate_backend($1)", [rows[0]?.pid]);

		await vi.waitFor(() =>
			expect(lock.assertHeld(stem)).rejects.toThrow(/was lost/),
		);
		// A sweep may take the run over from here on.
		expect(await tryLockRun(admin, stem)).toBe(true);
		await unlockRun(admin, stem);
	});

	it("refuses when the lock was released on a connection that is still up", async () => {
		const stem = fixtureStem();
		const lock = await open(stem);
		await unlockRun(lock.client, stem);

		await expect(lock.assertHeld(stem)).rejects.toThrow(/no longer held/);
	});

	it("refuses when the session holds the lock of another run only", async () => {
		const stem = fixtureStem();
		const lock = await open(stem);

		await expect(lock.assertHeld(fixtureStem())).rejects.toThrow(
			/no longer held/,
		);
	});
});

describe("removeRun", () => {
	it("removes the migration role of a run that has no database left to find it by", async () => {
		const stem = fixtureStem();
		const names = runNames(stem, 1);
		const roles = [names.scratch, names.workers[0] as string].map(
			migratorRoleName,
		);
		for (const role of roles) {
			await admin.query(`CREATE ROLE "${role}" NOLOGIN`);
		}
		const session = await liveSession(stem);

		await removeRun(session, maintenanceUrl, stem);

		for (const role of roles) expect(await roleExists(role)).toBe(false);
	});
});

describe("RunLock against the server's idle timeouts", () => {
	it("keeps the lock past an idle_session_timeout the connection string asks for", async () => {
		const stem = fixtureStem();
		const url = new URL(maintenanceUrl);
		url.searchParams.set("options", "-c idle_session_timeout=500");
		const lock = new RunLock(url.toString());
		await lock.connect();
		holders.push(lock.client);
		expect(await lock.take(stem)).toBe(true);

		await new Promise((resolve) => setTimeout(resolve, 2_000));

		await expect(lock.assertHeld(stem)).resolves.toBeUndefined();
		expect(await tryLockRun(admin, stem)).toBe(false);
	});

	it("does not call its own close a loss", async () => {
		const stem = fixtureStem();
		const lock = new RunLock(maintenanceUrl);
		await lock.connect();
		expect(await lock.take(stem)).toBe(true);
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			await lock.close();
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(logged).not.toHaveBeenCalled();
		} finally {
			logged.mockRestore();
		}
	});
});

describe("migratorRolesInUse", () => {
	it("lists a role that holds CREATE on a database with a session, and neither of the other two", async () => {
		const stem = fixtureStem();
		const names = runNames(stem, 1);
		const [busy, quiet2, ungranted] = [
			names.template,
			names.scratch,
			names.legacy,
		];
		const roles = [busy, quiet2, ungranted].map(migratorRoleName);
		for (const name of [busy, quiet2, ungranted]) {
			await admin.query(`CREATE DATABASE "${name}"`);
		}
		for (const role of roles) {
			await admin.query(`CREATE ROLE "${role}" NOLOGIN`);
		}
		await admin.query(`GRANT CREATE ON DATABASE "${busy}" TO "${roles[0]}"`);
		await admin.query(`GRANT CREATE ON DATABASE "${quiet2}" TO "${roles[1]}"`);
		// The third role has a session on its database but no CREATE: a
		// migration role is only in use while it holds the window.
		const sessions = [busy, ungranted].map(async (name) =>
			connect(maintenanceUrl.replace(/\/postgres(\?|$)/, `/${name}$1`)),
		);
		holders.push(...(await Promise.all(sessions)));
		try {
			const inUse = (await migratorRolesInUse(admin)).filter((role) =>
				roles.includes(role),
			);
			expect(inUse).toEqual([roles[0]]);
		} finally {
			for (const holder of holders.splice(0)) await holder.end();
			for (const name of [busy, quiet2, ungranted]) {
				await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
			}
			for (const role of roles) {
				await admin.query(`DROP OWNED BY "${role}"`).catch(() => {});
				await admin.query(`DROP ROLE IF EXISTS "${role}"`);
			}
		}
	});
});

describe("createMarkedTemplate", () => {
	it("creates the template with its marker", async () => {
		const stem = fixtureStem();
		await createMarkedTemplate(admin, stem, MARKER);

		expect(await exists(runNames(stem, 0).template)).toBe(true);
		expect(await markedRuns(admin, MARKER)).toEqual([stem]);
	});

	it("drops the template again when it cannot be marked", async () => {
		const stem = fixtureStem();
		// A NUL byte cannot be part of a comment: the statement is refused.
		await expect(
			createMarkedTemplate(admin, stem, "bad\u0000marker "),
		).rejects.toThrow();

		expect(await exists(runNames(stem, 0).template)).toBe(false);
	});
});

describe("migratorRolesByLiveness", () => {
	it("tells the role of a live run from the role of a dead one", async () => {
		const liveStem = fixtureStem();
		const deadStem = fixtureStem();
		await liveSession(liveStem);
		const live = await killedRun(liveStem);
		const dead = await killedRun(deadStem);

		const split = await migratorRolesByLiveness(admin, MARKER);

		expect(split.live).toEqual([...live.roles].sort());
		expect(split.dead).toEqual([...dead.roles].sort());
	});
});
