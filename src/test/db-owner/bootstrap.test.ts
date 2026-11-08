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
	/** How many REVOKE CREATE ON DATABASE statements fail before one works. */
	revokeFailures: number;
	/** What owner-fresh.sql answers: a brand-new install. */
	fresh: boolean;
	log: string[];
	logins: number;
};
const fake: Fake = {
	superuser: true,
	ownerLogins: [],
	problems: [],
	revokeFailures: 0,
	fresh: false,
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
		async query(sql: string) {
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
			if (sql.includes("user_schemas")) {
				return { rows: [{ fresh: fake.fresh }] };
			}
			if (sql.startsWith("REVOKE CREATE ON DATABASE")) {
				if (fake.revokeFailures > 0) {
					fake.revokeFailures--;
					throw new Error("connection terminated");
				}
				return { rows: [] };
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
		async end() {}
	}
	return { default: { Client } };
});

const { bootstrap } = await import("../../../scripts/db-owner/index.mjs");

beforeEach(() => {
	fake.superuser = true;
	fake.ownerLogins = [];
	fake.problems = [];
	fake.revokeFailures = 0;
	fake.fresh = false;
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
	const GRANT = 'GRANT CREATE ON DATABASE "retro" TO retrospend_owner';
	const REVOKE = 'REVOKE CREATE ON DATABASE "retro" FROM retrospend_owner';

	it("on a brand-new install grants CREATE on the database for the callback only, and revokes it after", async () => {
		fake.fresh = true;
		fake.ownerLogins = [true];
		let during: string[] = [];
		const result = await bootstrap("postgresql://postgres:pw@db/retro", {
			whileOwnerMayCreate: async (url) => {
				during = [...fake.log];
				expect(new URL(url).username).toBe("retrospend_owner");
			},
		});
		expect(result.status).toBe("switched");
		expect(during).toContain(GRANT);
		expect(during).not.toContain(REVOKE);
		expect(fake.log.indexOf(GRANT)).toBeGreaterThan(
			fake.log.indexOf("owner-handover.sql"),
		);
		expect(fake.log.indexOf(REVOKE)).toBeGreaterThan(fake.log.indexOf(GRANT));
	});

	it("decides from the catalogs before the owner is given anything", async () => {
		fake.fresh = true;
		fake.ownerLogins = [true];
		await bootstrap("postgresql://postgres:pw@db/retro", {
			whileOwnerMayCreate: async () => undefined,
		});
		const at = (line: string) => fake.log.indexOf(line);
		expect(at("owner-fresh.sql")).toBeGreaterThan(-1);
		expect(at("owner-fresh.sql")).toBeLessThan(at("owner-role.sql"));
		expect(at("owner-fresh.sql")).toBeLessThan(at("owner-handover.sql"));
	});

	it("on an upgrade or a later start grants nothing and marks nothing, but still runs the callback", async () => {
		fake.fresh = false;
		fake.ownerLogins = [true];
		let ran = false;
		await bootstrap("postgresql://postgres:pw@db/retro", {
			whileOwnerMayCreate: async () => {
				ran = true;
			},
		});
		expect(ran).toBe(true);
		for (const line of fake.log) {
			expect(line).not.toMatch(/GRANT CREATE|REVOKE CREATE|ALTER DATABASE/);
		}
	});

	it("keeps no marker between starts: a start that fails is not retried as a new install", async () => {
		fake.fresh = true;
		fake.ownerLogins = [true];
		await expect(
			bootstrap("postgresql://postgres:pw@db/retro", {
				whileOwnerMayCreate: async () => {
					throw new Error("Migration failed.");
				},
			}),
		).rejects.toThrow(/Migration failed/);
		expect(fake.log.some((line) => /ALTER DATABASE/.test(line))).toBe(false);
		// The retry looks at the catalogs again, and they now say it is not new.
		fake.fresh = false;
		fake.log = [];
		fake.logins = 0;
		fake.ownerLogins = [true, true];
		await bootstrap("postgresql://postgres:pw@db/retro", {
			whileOwnerMayCreate: async () => undefined,
		});
		expect(fake.log.some((line) => /GRANT CREATE/.test(line))).toBe(false);
	});

	it("grants nothing when there is no callback, and nothing for a URL it leaves alone", async () => {
		fake.fresh = true;
		fake.ownerLogins = [true];
		await bootstrap("postgresql://postgres:pw@db/retro");
		expect(fake.log).not.toContain(GRANT);
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

	it("revokes even when the callback fails, and still fails", async () => {
		fake.fresh = true;
		fake.ownerLogins = [true];
		await expect(
			bootstrap("postgresql://postgres:pw@db/retro", {
				whileOwnerMayCreate: async () => {
					throw new Error("Migration failed.");
				},
			}),
		).rejects.toThrow(/Migration failed/);
		expect(fake.log).toContain(GRANT);
		expect(fake.log).toContain(REVOKE);
	});

	it("revokes on a new connection when the open one died during the migrations", async () => {
		fake.fresh = true;
		fake.ownerLogins = [true];
		fake.revokeFailures = 1;
		await bootstrap("postgresql://postgres:pw@db/retro", {
			whileOwnerMayCreate: async () => undefined,
		});
		expect(fake.log.filter((line) => line === REVOKE)).toHaveLength(2);
	});
});
