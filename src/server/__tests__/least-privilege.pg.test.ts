/**
 * Least privilege for retrospend_app (access hardening plan, PR 2), seen from
 * the app role: what a scoped transaction can no longer do to the user table
 * and to the auth tables, and that what the app still needs keeps working
 * (profile and settings writes, an account leg through the invoker trigger,
 * v1 search). The grant list itself is pinned by src/test/migrations/
 * privileges.pg.test.ts.
 */
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	adminDb,
	asMobile,
	call,
	expectBody,
} from "~/server/api/v1/core/__tests__/harness";
import { userTransaction } from "~/server/db-tx";
import { storeEmailVerificationToken } from "~/server/services/account-security.service";
import { forUser } from "~/server/services/preview";
import {
	arsUser,
	balanceOf,
	openAccount,
	seedArsRates,
} from "~/server/services/accounts/test-fixtures";
import { updateBalance } from "~/server/services/accounts/update-balance.mutation";
import { createTestUser } from "~/test/pg-harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const DENIED = /permission denied/i;

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

/** Runs `work` as retrospend_app for `user`, like every scoped request. */
const asApp = <T>(
	user: TestUser,
	work: Parameters<typeof userTransaction<T>>[2],
) => userTransaction(adminDb, user.user.id, work);

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
	alice = await createTestUser();
	bob = await createTestUser();
});

describe("the user table", () => {
	it("cannot be deleted from, for anyone", async () => {
		await expect(
			asApp(alice, (tx) => tx.user.delete({ where: { id: alice.user.id } })),
		).rejects.toThrow(DENIED);
		await expect(
			asApp(alice, (tx) => tx.user.deleteMany({ where: { id: bob.user.id } })),
		).rejects.toThrow(DENIED);
		await expect(
			asApp(alice, (tx) => tx.user.deleteMany()),
		).rejects.toThrow(DENIED);
		expect(
			await adminDb.user.count({
				where: { id: { in: [alice.user.id, bob.user.id] } },
			}),
		).toBe(2);
	});

	it("cannot be inserted into", async () => {
		await expect(
			asApp(alice, (tx) =>
				tx.user.create({
					data: {
						name: "Planted",
						username: `planted_${Date.now()}`,
						email: `planted_${Date.now()}@pg-test.invalid`,
					},
				}),
			),
		).rejects.toThrow(DENIED);
	});

	it("cannot change another user's row, even a column it may write", async () => {
		const result = await asApp(alice, (tx) =>
			tx.user.updateMany({
				where: { id: bob.user.id },
				data: { name: "Hijacked" },
			}),
		);
		expect(result.count).toBe(0);
		await expect(
			asApp(alice, (tx) =>
				tx.user.update({
					where: { id: bob.user.id },
					data: { homeCurrency: "ARS" },
				}),
			),
		).rejects.toThrow();
		const stored = await adminDb.user.findUniqueOrThrow({
			where: { id: bob.user.id },
		});
		expect(stored.name).toBe(bob.user.name);
		expect(stored.homeCurrency).toBe("USD");
	});

	it("cannot be pointed at another user's id to change what the row is", async () => {
		// The own-row policy also checks the row after the change.
		await expect(
			asApp(alice, (tx) =>
				tx.user.update({
					where: { id: alice.user.id },
					data: { id: bob.user.id },
				}),
			),
		).rejects.toThrow(DENIED);
	});

	for (const [column, data] of [
		["role", { role: "ADMIN" }],
		["email", { email: "taken-over@pg-test.invalid" }],
		["emailVerified", { emailVerified: true }],
		["isActive", { isActive: false }],
		["username", { username: "someone_else_now" }],
		["lastUsernameChangeAt", { lastUsernameChangeAt: new Date(0) }],
		["twoFactorEnabled", { twoFactorEnabled: true }],
		["externalAiAllowed", { externalAiAllowed: true }],
	] as const) {
		it(`cannot change its own ${column}`, async () => {
			await expect(
				asApp(alice, (tx) =>
					tx.user.update({ where: { id: alice.user.id }, data }),
				),
			).rejects.toThrow(DENIED);
			const stored = await adminDb.user.findUniqueOrThrow({
				where: { id: alice.user.id },
			});
			expect(stored.role).toBe("USER");
			expect(stored.email).toBe(alice.user.email);
			expect(stored.username).toBe(alice.user.username);
			expect(stored.isActive).toBe(true);
		});
	}

	it("can change its own profile and settings", async () => {
		const carol = await createTestUser();
		await asApp(carol, (tx) =>
			tx.user.update({
				where: { id: carol.user.id },
				data: {
					name: "Carol Renamed",
					avatarPath: "avatars/carol.webp",
					pendingEmail: "carol-new@pg-test.invalid",
					pendingEmailToken: `hash-${carol.user.id}`,
					pendingEmailExpiresAt: new Date("2030-01-01T00:00:00Z"),
					homeCurrency: "ARS",
					defaultCurrency: "ARS",
					timeZone: "America/Argentina/Buenos_Aires",
					language: "es",
					fiscalMonthStartDay: 5,
					defaultRateTypes: { ARS: "blue" },
					defaultAccounts: { ARS: "acc-1" },
					consentedAt: new Date("2026-11-01T00:00:00Z"),
					consentVersion: "2026-11",
					consentIp: "203.0.113.9",
				},
				select: { id: true },
			}),
		);
		const stored = await adminDb.user.findUniqueOrThrow({
			where: { id: carol.user.id },
		});
		expect(stored).toMatchObject({
			name: "Carol Renamed",
			avatarPath: "avatars/carol.webp",
			pendingEmail: "carol-new@pg-test.invalid",
			homeCurrency: "ARS",
			defaultCurrency: "ARS",
			timeZone: "America/Argentina/Buenos_Aires",
			language: "es",
			fiscalMonthStartDay: 5,
			consentVersion: "2026-11",
			consentIp: "203.0.113.9",
		});
		expect(stored.defaultRateTypes).toEqual({ ARS: "blue" });
		expect(stored.updatedAt.getTime()).toBeGreaterThanOrEqual(
			carol.user.updatedAt.getTime(),
		);
		// Email and role are still what the owner connection wrote.
		expect(stored.email).toBe(carol.user.email);
		expect(stored.role).toBe("USER");
	});

	it("still reads every user's name for shared views", async () => {
		const seen = await asApp(alice, (tx) =>
			tx.user.findMany({
				where: { id: { in: [alice.user.id, bob.user.id] } },
				select: { id: true, name: true },
			}),
		);
		expect(seen.map((u) => u.id).sort()).toEqual(
			[alice.user.id, bob.user.id].sort(),
		);
	});

	it("cannot read the pending email token or the consent address", async () => {
		await adminDb.user.update({
			where: { id: alice.user.id },
			data: {
				pendingEmailToken: `tok-${alice.user.id}`,
				consentIp: "203.0.113.7",
			},
		});
		for (const column of ["pendingEmailToken", "consentIp"] as const) {
			await expect(
				asApp(alice, (tx) =>
					tx.user.findUnique({
						where: { id: alice.user.id },
						select: { [column]: true },
					}),
				),
			).rejects.toThrow(DENIED);
			// Not even to find a row by it.
			await expect(
				asApp(alice, (tx) =>
					tx.user.findFirst({
						where: { [column]: { not: null } },
						select: { id: true },
					}),
				),
			).rejects.toThrow(DENIED);
		}
		// A read that names no columns asks for all of them, so it is denied too.
		await expect(
			asApp(alice, (tx) =>
				tx.user.findUnique({ where: { id: alice.user.id } }),
			),
		).rejects.toThrow(DENIED);
		// Another user's secret is as closed as one's own.
		await expect(
			asApp(alice, (tx) =>
				tx.user.findUnique({
					where: { id: bob.user.id },
					select: { pendingEmailToken: true },
				}),
			),
		).rejects.toThrow(DENIED);
		// Everything else stays readable, including the pending address itself.
		const own = await asApp(alice, (tx) =>
			tx.user.findUnique({
				where: { id: alice.user.id },
				select: { name: true, email: true, role: true, pendingEmail: true },
			}),
		);
		expect(own).toMatchObject({ email: alice.user.email, role: "USER" });
		await adminDb.user.update({
			where: { id: alice.user.id },
			data: { pendingEmailToken: null, consentIp: null },
		});
	});

	it("an update that returns every column is denied, one that selects is not", async () => {
		await expect(
			asApp(alice, (tx) =>
				tx.user.update({
					where: { id: alice.user.id },
					data: { name: alice.user.name },
				}),
			),
		).rejects.toThrow(DENIED);
		await asApp(alice, (tx) =>
			tx.user.update({
				where: { id: alice.user.id },
				data: { name: alice.user.name },
				select: { id: true },
			}),
		);
	});

	it("is still fully writable on the owner connection", async () => {
		const dave = await createTestUser();
		await adminDb.user.update({
			where: { id: dave.user.id },
			data: { role: "ADMIN", emailVerified: true },
		});
		await adminDb.user.delete({ where: { id: dave.user.id } });
		expect(await adminDb.user.count({ where: { id: dave.user.id } })).toBe(0);
	});
});

describe("auth tables", () => {
	it("verification tokens cannot be read, written or deleted", async () => {
		const token = await adminDb.verificationToken.create({
			data: {
				identifier: alice.user.email,
				token: `secret-${alice.user.id}`,
				expires: new Date(Date.now() + 3_600_000),
			},
		});
		await expect(
			asApp(alice, (tx) => tx.verificationToken.findMany()),
		).rejects.toThrow(DENIED);
		await expect(
			asApp(alice, (tx) =>
				tx.verificationToken.create({
					data: { identifier: "x", token: "y", expires: new Date() },
				}),
			),
		).rejects.toThrow(DENIED);
		await expect(
			asApp(alice, (tx) =>
				tx.verificationToken.deleteMany({ where: { token: token.token } }),
			),
		).rejects.toThrow(DENIED);
		await adminDb.verificationToken.delete({ where: { token: token.token } });
	});

	it("a new verification token replaces the old one on the owner connection", async () => {
		const frank = await createTestUser();
		const expires = new Date(Date.now() + 3_600_000);
		await storeEmailVerificationToken(frank.user.email, "first", expires);
		await storeEmailVerificationToken(frank.user.email, "second", expires);
		const rows = await adminDb.verificationToken.findMany({
			where: { identifier: frank.user.email },
		});
		expect(rows.map((r) => r.token)).toEqual(["second"]);
		await adminDb.verificationToken.deleteMany({
			where: { identifier: frank.user.email },
		});
	});

	it("password reset tokens, sessions, accounts and second factors are closed", async () => {
		await expect(
			asApp(alice, (tx) => tx.passwordResetToken.findMany()),
		).rejects.toThrow(DENIED);
		await expect(asApp(alice, (tx) => tx.session.findMany())).rejects.toThrow(
			DENIED,
		);
		await expect(
			asApp(alice, (tx) => tx.session.deleteMany({})),
		).rejects.toThrow(DENIED);
		await expect(asApp(alice, (tx) => tx.account.findMany())).rejects.toThrow(
			DENIED,
		);
		await expect(
			asApp(alice, (tx) =>
				tx.account.updateMany({ data: { password: "known" } }),
			),
		).rejects.toThrow(DENIED);
		await expect(asApp(alice, (tx) => tx.twoFactor.findMany())).rejects.toThrow(
			DENIED,
		);
	});

	it("the audit event log, app settings and username history are closed", async () => {
		await expect(asApp(alice, (tx) => tx.eventLog.findMany())).rejects.toThrow(
			DENIED,
		);
		await expect(
			asApp(alice, (tx) =>
				tx.eventLog.create({ data: { eventType: "SETTINGS_UPDATED" } }),
			),
		).rejects.toThrow(DENIED);
		await expect(
			asApp(alice, (tx) => tx.appSettings.findMany()),
		).rejects.toThrow(DENIED);
		await expect(
			asApp(alice, (tx) => tx.usernameHistory.findMany()),
		).rejects.toThrow(DENIED);
		await expect(
			asApp(alice, (tx) =>
				tx.usernameHistory.create({
					data: { userId: alice.user.id, previousUsername: "squatted" },
				}),
			),
		).rejects.toThrow(DENIED);
	});

	it("the migration table is closed", async () => {
		await expect(
			asApp(alice, (tx) => tx.$queryRaw`SELECT 1 FROM "_prisma_migrations"`),
		).rejects.toThrow(DENIED);
	});

	it("invite codes keep read, create and delete but never update", async () => {
		const code = await asApp(alice, (tx) =>
			tx.inviteCode.create({
				data: { code: `inv-${alice.user.id}`, createdById: alice.user.id },
			}),
		);
		expect(
			(await asApp(alice, (tx) => tx.inviteCode.findMany())).map((c) => c.id),
		).toContain(code.id);
		await expect(
			asApp(alice, (tx) =>
				tx.inviteCode.update({
					where: { id: code.id },
					data: { usedAt: new Date() },
				}),
			),
		).rejects.toThrow(DENIED);
		await asApp(alice, (tx) =>
			tx.inviteCode.delete({ where: { id: code.id } }),
		);
	});

	it("invite codes belong to the user who made them", async () => {
		const bobs = await adminDb.inviteCode.create({
			data: { code: `bob-${bob.user.id}`, createdById: bob.user.id },
		});
		try {
			// Not listed, not found by code, not deletable.
			expect(await asApp(alice, (tx) => tx.inviteCode.findMany())).toEqual([]);
			expect(
				await asApp(alice, (tx) =>
					tx.inviteCode.findUnique({ where: { code: bobs.code } }),
				),
			).toBeNull();
			expect(
				(await asApp(alice, (tx) => tx.inviteCode.deleteMany({}))).count,
			).toBe(0);
			await expect(
				asApp(alice, (tx) => tx.inviteCode.delete({ where: { id: bobs.id } })),
			).rejects.toThrow();
			// Cannot create one in Bob's name.
			await expect(
				asApp(alice, (tx) =>
					tx.inviteCode.create({
						data: { code: `forged-${alice.user.id}`, createdById: bob.user.id },
					}),
				),
			).rejects.toThrow(/row-level security/);
			// A code Bob holds clashes as a unique violation, not as a read.
			await expect(
				asApp(alice, (tx) =>
					tx.inviteCode.create({
						data: { code: bobs.code, createdById: alice.user.id },
					}),
				),
			).rejects.toMatchObject({ code: "P2002" });
			expect(await adminDb.inviteCode.count({ where: { id: bobs.id } })).toBe(
				1,
			);
		} finally {
			await adminDb.inviteCode.delete({ where: { id: bobs.id } });
		}
	});

	it("a user's invite codes list with the names of who made and used them", async () => {
		const mine = await asApp(alice, (tx) =>
			tx.inviteCode.create({
				data: { code: `list-${alice.user.id}`, createdById: alice.user.id },
			}),
		);
		const rows = await asApp(alice, (tx) =>
			tx.inviteCode.findMany({
				where: { createdById: alice.user.id },
				include: {
					createdBy: { select: { username: true, name: true } },
					usedBy: { select: { username: true, name: true } },
				},
			}),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.createdBy.username).toBe(alice.user.username);
		await adminDb.inviteCode.delete({ where: { id: mine.id } });
	});

	it("the audit log of shared expenses cannot be rewritten", async () => {
		await expect(
			asApp(alice, (tx) =>
				tx.auditLogEntry.updateMany({ data: { actorId: alice.user.id } }),
			),
		).rejects.toThrow(DENIED);
		await expect(
			asApp(alice, (tx) => tx.auditLogEntry.deleteMany({})),
		).rejects.toThrow(DENIED);
	});
});

describe("what scoped paths still do", () => {
	beforeAll(seedArsRates);

	it("an account leg that moves a balance runs the invoker trigger", async () => {
		const { user } = await arsUser();
		const id = await openAccount(user.id, "Savings", "CASH", "ARS", 1000);

		// forUser(...).apply runs in userTransaction: every statement, and the
		// account_leg triggers it fires, run as retrospend_app.
		await forUser(user.id).apply(updateBalance, {
			accountId: id,
			balance: "1250",
		});

		expect(await balanceOf(id)).toBe("1250");
		const legs = await adminDb.accountLeg.findMany({
			where: { accountId: id },
		});
		expect(legs.length).toBeGreaterThan(0);
	});

	it("v1 search finds the caller's own expenses", async () => {
		const erin = await createTestUser();
		await adminDb.expense.create({
			data: {
				userId: erin.user.id,
				title: "Café con leche",
				amount: "1234.50",
				currency: "ARS",
				date: new Date("2026-10-01T12:00:00Z"),
				amountInUSD: "1.00",
				exchangeRate: "1234.5",
				pricingSource: "blue",
			},
		});
		const headers = await asMobile(erin.user.id);
		const result = await expectBody<{
			groups: { type: string; items: { title?: string }[] }[];
		}>(await call("/search?q=cafe&types=expenses", { headers }), contract.search.search);
		const expenses =
			result.groups.find((g) => g.type === "expenses")?.items ?? [];
		expect(expenses.map((e) => e.title)).toEqual(["Café con leche"]);
	});
});
