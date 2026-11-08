// The bootstrap's decisions, with the database replaced by a recording fake:
// which URLs it leaves alone, and the order of what it does to one it takes
// over. The real database side is src/test/migrations/owner-role.pg.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Fake = {
	/** Result of `SELECT rolsuper ...` for the URL's user. */
	superuser: boolean;
	/** Whether the owner can sign in, by attempt number (1-based). */
	ownerLogins: boolean[];
	/** What the role check (owner-verify.sql) finds, one answer per call. */
	problems: string[][];
	/** How many REASSIGN OWNED statements fail (the connection died) before one works. */
	cleanupFailures: number;
	/** What owner-fresh.sql answers, one answer per call: a brand-new install. */
	freshAnswers: boolean[];
	/** The roles that exist. */
	roles: Set<string>;
	log: string[];
	logins: number;
};
const fake: Fake = {
	superuser: true,
	ownerLogins: [],
	problems: [],
	cleanupFailures: 0,
	freshAnswers: [],
	roles: new Set(),
	log: [],
	logins: 0,
};

vi.mock("pg", () => {
	class Client {
		constructor(private readonly config: { connectionString: string }) {}
		async connect() {
			if (
				new URL(this.config.connectionString).username === "retrospend_owner"
			) {
				const ok = fake.ownerLogins[fake.logins++];
				if (!ok) throw new Error("password authentication failed");
			}
		}
		async query(sql: string, params: string[] = []) {
			// The bootstrap's SQL files are long: log which one ran.
			fake.log.push(
				sql.includes("CREATE ROLE retrospend_owner")
					? "owner-role.sql"
					: sql.includes("ALTER SCHEMA %I OWNER")
						? "owner-handover.sql"
						: sql.includes("user_schemas")
							? "owner-fresh.sql"
							: sql.includes("owner is a member of")
								? "owner-verify.sql"
								: sql.includes("pg_auth_members") && sql.includes("GRANTED BY")
									? "owner-unsafe-grants.sql"
									: (sql.trim().split("\n")[0] ?? ""),
			);
			if (sql.includes("quote_ident")) return { rows: [{ name: '"retro"' }] };
			if (sql.includes("current_database() AS name")) {
				return { rows: [{ name: "retro" }] };
			}
			if (sql.includes("user_schemas")) {
				return { rows: [{ fresh: fake.freshAnswers.shift() ?? false }] };
			}
			if (sql.includes("FROM pg_catalog.pg_roles WHERE rolname = $1")) {
				return { rows: fake.roles.has(params[0] ?? "") ? [{}] : [] };
			}
			const created = /^CREATE ROLE "([^"]+)"/.exec(sql);
			if (created?.[1]) fake.roles.add(created[1]);
			const dropped = /^DROP ROLE "([^"]+)"/.exec(sql);
			if (dropped?.[1]) fake.roles.delete(dropped[1]);
			if (sql.startsWith("REASSIGN OWNED") && fake.cleanupFailures > 0) {
				fake.cleanupFailures--;
				throw new Error("connection terminated");
			}
			if (sql.includes("owner is a member of")) {
				return {
					rows: (fake.problems.shift() ?? []).map((problem) => ({ problem })),
				};
			}
			if (sql.includes("pg_auth_members") && sql.includes("GRANTED BY")) {
				return {
					rows: [
						{
							ddl: "REVOKE pg_execute_server_program FROM retrospend_owner GRANTED BY postgres CASCADE",
						},
					],
				};
			}
			if (sql.startsWith("REVOKE ")) fake.log.push(sql);
			if (sql.includes("SELECT rolsuper")) {
				const owner =
					new URL(this.config.connectionString).username === "retrospend_owner";
				return { rows: [{ rolsuper: owner ? false : fake.superuser }] };
			}
			if (sql.startsWith("ALTER ROLE")) fake.log.push(`ALTER ROLE: ${sql}`);
			return { rows: [] };
		}
		escapeLiteral(value: string) {
			return `'${value}'`;
		}
		escapeIdentifier(value: string) {
			return `"${value}"`;
		}
		async end() {}
	}
	return { default: { Client } };
});

const { bootstrap, migratorRoleName } = await import(
	"../../../scripts/db-owner/index.mjs"
);

beforeEach(() => {
	fake.superuser = true;
	fake.ownerLogins = [];
	fake.problems = [];
	fake.cleanupFailures = 0;
	fake.freshAnswers = [];
	fake.roles = new Set(["retrospend_owner"]);
	fake.log = [];
	fake.logins = 0;
});

describe("bootstrap leaves a URL alone", () => {
	it("when it is not a superuser's (managed Postgres, or set up by hand)", async () => {
		fake.superuser = false;
		const result = await bootstrap("postgresql://app:pw@db/retro");
		expect(result).toEqual({ status: "unchanged", reason: "not-superuser" });
		expect(fake.log.some((line) => line.startsWith("owner-"))).toBe(false);
	});

	it("when a superuser has no password, with a loud warning and no change", async () => {
		const warn = vi.fn();
		const result = await bootstrap("postgresql://postgres@db/retro", { warn });
		expect(result).toEqual({ status: "unchanged", reason: "no-password" });
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0]?.[0]).toMatch(/^WARNING: .*without a password/);
		expect(fake.log.some((line) => /owner-|BEGIN/.test(line))).toBe(false);
	});

	it("when the password is not valid percent-encoding", async () => {
		const warn = vi.fn();
		const result = await bootstrap("postgresql://postgres:ab%zz@db/retro", {
			warn,
		});
		expect(result).toEqual({
			status: "unchanged",
			reason: "unreadable-password",
		});
		expect(warn.mock.calls[0]?.[0]).toMatch(/percent-encoded/);
	});
});

describe("bootstrap on a superuser URL with a password", () => {
	it("does not set the password when the owner can already sign in", async () => {
		fake.ownerLogins = [true];
		const result = await bootstrap("postgresql://postgres:pw@db/retro");
		expect(result.status).toBe("switched");
		expect(fake.log.some((line) => line.startsWith("ALTER ROLE"))).toBe(false);
		expect(fake.log).toContain("owner-role.sql");
		expect(fake.log).toContain("owner-handover.sql");
	});

	it("sets a SCRAM verifier, with statement logging off, only when the login fails", async () => {
		fake.ownerLogins = [false, true];
		const result = await bootstrap("postgresql://postgres:pw@db/retro");
		expect(result.status).toBe("switched");
		const set = fake.log.indexOf("SET LOCAL log_statement = 'none'");
		const alter = fake.log.findIndex((line) => line.startsWith("ALTER ROLE:"));
		expect(set).toBeGreaterThan(-1);
		expect(alter).toBeGreaterThan(set);
		const statement = fake.log[alter] ?? "";
		expect(statement).toMatch(
			/ALTER ROLE retrospend_owner PASSWORD 'SCRAM-SHA-256\$\d+:[^$]+\$[^:]+:.+'/,
		);
		// The derived password itself is never sent, only its verifier.
		expect(statement).not.toMatch(/PASSWORD '[0-9a-f]{64}'/);
		expect(fake.log.indexOf("COMMIT")).toBeGreaterThan(alter);
	});

	it("fails the start when the owner still cannot sign in after the reset", async () => {
		fake.ownerLogins = [false, false];
		await expect(
			bootstrap("postgresql://postgres:pw@db/retro"),
		).rejects.toThrow(/cannot sign in/);
	});

	it("takes DATABASE_OWNER_PASSWORD even when the URL has no password", async () => {
		fake.ownerLogins = [true];
		const result = await bootstrap("postgresql://postgres@db/retro", {
			ownerPassword: "own-secret",
		});
		expect(result.status).toBe("switched");
		if (result.status === "switched") {
			expect(new URL(result.ownerUrl).password).toBe("own-secret");
		}
	});
});

describe("bootstrap checks the role from the catalogs", () => {
	it("checks before the owner signs in and again as the owner", async () => {
		fake.ownerLogins = [true];
		await bootstrap("postgresql://postgres:pw@db/retro");
		expect(fake.log.filter((line) => line === "owner-verify.sql")).toHaveLength(
			2,
		);
		expect(fake.log.indexOf("owner-role.sql")).toBeLessThan(
			fake.log.indexOf("owner-verify.sql"),
		);
	});

	it("revokes what the owner holds beyond its rights, says so loudly and refuses to start", async () => {
		const warn = vi.fn();
		fake.ownerLogins = [true];
		fake.problems = [["owner is a member of pg_execute_server_program"], []];
		await expect(
			bootstrap("postgresql://postgres:pw@db/retro", { warn }),
		).rejects.toThrow(/held more than it may.*removed, start again/);
		expect(warn.mock.calls[0]?.[0]).toMatch(
			/^WARNING: .*pg_execute_server_program/,
		);
		expect(fake.log).toContain(
			"REVOKE pg_execute_server_program FROM retrospend_owner GRANTED BY postgres CASCADE",
		);
		// No handover, no password, no login after a refusal.
		expect(fake.log).not.toContain("owner-handover.sql");
		expect(fake.logins).toBe(0);
	});

	it("refuses too when it cannot remove it", async () => {
		fake.problems = [["attribute superuser"], ["attribute superuser"]];
		await expect(
			bootstrap("postgresql://postgres:pw@db/retro", { warn: vi.fn() }),
		).rejects.toThrow(/could not be removed/);
	});

	it("does not call a login that holds too much a login failure", async () => {
		fake.ownerLogins = [true];
		fake.problems = [
			[],
			["owner holds pg_read_server_files (directly or through another role)"],
		];
		await expect(
			bootstrap("postgresql://postgres:pw@db/retro"),
		).rejects.toThrow(/holds more than it may/);
		expect(fake.log.some((line) => line.startsWith("ALTER ROLE"))).toBe(false);
	});
});

describe("bootstrap's migration window", () => {
	const MIGRATOR = migratorRoleName("retro");
	const DB = '"retro"';
	const created = () =>
		fake.log.findIndex((line) => line.startsWith(`CREATE ROLE "${MIGRATOR}"`));
	const at = (line: string) => fake.log.indexOf(line);
	const grantedToOwner = () =>
		fake.log.some((line) =>
			/GRANT CREATE ON DATABASE .* TO "?retrospend_owner/.test(line),
		);

	it("names a one-shot role for the database, never the owner's", () => {
		expect(MIGRATOR).toMatch(/^retrospend_migrator_[0-9a-f]{12}$/);
		expect(migratorRoleName("other")).not.toBe(MIGRATOR);
	});

	it("on a brand-new install runs the migrations as that role, which alone holds CREATE", async () => {
		fake.freshAnswers = [true, true];
		fake.ownerLogins = [true];
		let during: string[] = [];
		let seen: URL | undefined;
		const result = await bootstrap("postgresql://postgres:pw@db/retro", {
			whileOwnerMayCreate: async (url) => {
				during = [...fake.log];
				seen = new URL(url);
				expect(fake.roles.has(MIGRATOR)).toBe(true);
			},
		});
		expect(result.status).toBe("switched");
		expect(seen?.username).toBe(MIGRATOR);
		// A random password for this start, not the owner's.
		expect(seen?.password).toMatch(/^[0-9a-f]{48}$/);
		expect(during).toContain(`GRANT CREATE ON DATABASE ${DB} TO "${MIGRATOR}"`);
		expect(during).toContain(`ALTER SCHEMA public OWNER TO "${MIGRATOR}"`);
		expect(during).toContain(`ALTER SCHEMA keystore OWNER TO "${MIGRATOR}"`);
		// The owner never holds CREATE.
		expect(grantedToOwner()).toBe(false);
		expect(
			fake.log.some(
				(line) =>
					/GRANT CREATE ON DATABASE/.test(line) && !line.includes(MIGRATOR),
			),
		).toBe(false);
	});

	it("creates it with the rights of a migration and no more", async () => {
		fake.freshAnswers = [true, true];
		fake.ownerLogins = [true];
		await bootstrap("postgresql://postgres:pw@db/retro", {
			whileOwnerMayCreate: async () => undefined,
		});
		const statement = fake.log[created()] ?? "";
		for (const word of [
			"LOGIN",
			"NOSUPERUSER",
			"NOCREATEROLE",
			"NOCREATEDB",
			"NOINHERIT",
			"NOREPLICATION",
			"BYPASSRLS",
		]) {
			expect(statement, word).toContain(word);
		}
		// Not a member of the owner; the app role with ADMIN OPTION only, for an
		// old migration's GRANT retrospend_app TO CURRENT_USER.
		expect(fake.log).toContain(
			`GRANT retrospend_app TO "${MIGRATOR}" WITH ADMIN OPTION`,
		);
		expect(
			fake.log.some((line) => /GRANT retrospend_owner TO/.test(line)),
		).toBe(false);
		// Created with a SCRAM verifier, with statement logging off for it.
		expect(statement).toMatch(/PASSWORD 'SCRAM-SHA-256\$4096:/);
		expect(fake.log.indexOf("SET LOCAL log_statement = 'none'")).toBeLessThan(
			created(),
		);
	});

	it("takes it all back afterwards, in order, before the handover", async () => {
		fake.freshAnswers = [true, true];
		fake.ownerLogins = [true];
		await bootstrap("postgresql://postgres:pw@db/retro", {
			whileOwnerMayCreate: async () => undefined,
		});
		const steps = [
			`REVOKE CREATE ON DATABASE ${DB} FROM "${MIGRATOR}"`,
			`REASSIGN OWNED BY "${MIGRATOR}" TO retrospend_owner`,
			`DROP OWNED BY "${MIGRATOR}"`,
			`DROP ROLE "${MIGRATOR}"`,
		].map(at);
		expect(steps.every((i) => i > -1)).toBe(true);
		expect([...steps].sort((a, b) => a - b)).toEqual(steps);
		expect(steps[0]).toBeGreaterThan(
			at(`GRANT CREATE ON DATABASE ${DB} TO "${MIGRATOR}"`),
		);
		expect(steps[3]).toBeLessThan(at("owner-handover.sql"));
		expect(fake.roles.has(MIGRATOR)).toBe(false);
	});

	it("takes it back when the migrations fail, and still fails", async () => {
		fake.freshAnswers = [true, true];
		fake.ownerLogins = [true];
		await expect(
			bootstrap("postgresql://postgres:pw@db/retro", {
				whileOwnerMayCreate: async () => {
					throw new Error("Migration failed.");
				},
			}),
		).rejects.toThrow(/Migration failed/);
		expect(fake.log).toContain(`DROP ROLE "${MIGRATOR}"`);
		expect(fake.roles.has(MIGRATOR)).toBe(false);
	});

	it("removes it on a new connection when the open one died during the migrations", async () => {
		fake.freshAnswers = [true, true];
		fake.ownerLogins = [true];
		fake.cleanupFailures = 1;
		await bootstrap("postgresql://postgres:pw@db/retro", {
			whileOwnerMayCreate: async () => undefined,
		});
		expect(
			fake.log.filter((line) => line.startsWith("REASSIGN OWNED")),
		).toHaveLength(2);
		expect(fake.roles.has(MIGRATOR)).toBe(false);
	});

	it("looks again after the schemas changed hands, and gives no window if something got in", async () => {
		fake.freshAnswers = [true, false];
		fake.ownerLogins = [true];
		let url: URL | undefined;
		let handedOver = false;
		await bootstrap("postgresql://postgres:pw@db/retro", {
			whileOwnerMayCreate: async (u) => {
				url = new URL(u);
				handedOver = at("owner-handover.sql") > -1;
			},
		});
		// Run as the owner after the handover, with no CREATE for anyone.
		expect(url?.username).toBe("retrospend_owner");
		expect(handedOver).toBe(true);
		expect(grantedToOwner()).toBe(false);
		expect(fake.roles.has(MIGRATOR)).toBe(false);
	});

	it("decides from the catalogs before the owner is given anything", async () => {
		fake.freshAnswers = [true, true];
		fake.ownerLogins = [true];
		await bootstrap("postgresql://postgres:pw@db/retro", {
			whileOwnerMayCreate: async () => undefined,
		});
		expect(at("owner-fresh.sql")).toBeGreaterThan(-1);
		expect(at("owner-fresh.sql")).toBeLessThan(at("owner-role.sql"));
		expect(at("owner-fresh.sql")).toBeLessThan(created());
	});

	it("on an upgrade or a later start has no migration role and no CREATE, and migrates as the owner after the handover", async () => {
		fake.freshAnswers = [false];
		fake.ownerLogins = [true];
		let url: URL | undefined;
		let after = -1;
		await bootstrap("postgresql://postgres:pw@db/retro", {
			whileOwnerMayCreate: async (u) => {
				url = new URL(u);
				after = at("owner-handover.sql");
			},
		});
		expect(url?.username).toBe("retrospend_owner");
		expect(after).toBeGreaterThan(-1);
		for (const line of fake.log) {
			expect(line).not.toMatch(
				/GRANT CREATE|REVOKE CREATE|CREATE ROLE "retrospend_migrator|ALTER DATABASE/,
			);
		}
	});

	it("removes a migration role that a killed start left, before anything else", async () => {
		fake.roles.add(MIGRATOR);
		fake.freshAnswers = [false];
		fake.ownerLogins = [true];
		await bootstrap("postgresql://postgres:pw@db/retro");
		expect(fake.roles.has(MIGRATOR)).toBe(false);
		expect(at(`DROP ROLE "${MIGRATOR}"`)).toBeGreaterThan(-1);
		expect(
			at(`REASSIGN OWNED BY "${MIGRATOR}" TO retrospend_owner`),
		).toBeLessThan(at(`DROP OWNED BY "${MIGRATOR}"`));
		expect(at(`DROP ROLE "${MIGRATOR}"`)).toBeLessThan(at("owner-role.sql"));
	});

	it("never logs the migration role's password", async () => {
		fake.freshAnswers = [true, true];
		fake.ownerLogins = [true];
		let password = "";
		await bootstrap("postgresql://postgres:pw@db/retro", {
			whileOwnerMayCreate: async (url) => {
				password = new URL(url).password;
			},
		});
		expect(password).not.toBe("");
		for (const line of fake.log) expect(line).not.toContain(password);
	});

	it("grants nothing when there is no callback, and nothing for a URL it leaves alone", async () => {
		fake.freshAnswers = [true];
		fake.ownerLogins = [true];
		await bootstrap("postgresql://postgres:pw@db/retro");
		expect(created()).toBe(-1);
		fake.log = [];
		fake.superuser = false;
		await bootstrap("postgresql://app:pw@db/retro", {
			whileOwnerMayCreate: async () => {
				throw new Error("must not run");
			},
		});
		expect(fake.log.some((line) => line.includes("CREATE ON DATABASE"))).toBe(
			false,
		);
	});
});
