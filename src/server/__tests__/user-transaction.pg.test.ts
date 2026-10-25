/**
 * Interactive transactions on the user-scoped client, on a real Postgres,
 * through the real protectedProcedure middleware (ctx.db is the scoped
 * client). Every write inside `userTransaction(ctx.db, ...)` must run on the
 * transaction's one connection: all of it commits, or none of it does.
 */
import { TRPCError } from "@trpc/server";
import { beforeAll, describe, expect, it } from "vitest";
import {
	createCallerFactory,
	createTRPCRouter,
	protectedProcedure,
} from "~/server/api/trpc";
import { userTransaction } from "~/server/db-tx";
import {
	arsUser,
	balanceOf,
	openAccount,
	seedArsRates,
} from "~/server/services/accounts/test-fixtures";
import { updateBalance } from "~/server/services/accounts/update-balance.mutation";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import { wealthRouter } from "../api/routers/wealth";

const probe = createTRPCRouter({
	writeTwoThenThrow: protectedProcedure.mutation(({ ctx }) =>
		userTransaction(ctx.db, ctx.session.user.id, async (tx) => {
			const userId = ctx.session.user.id;
			await tx.category.create({
				data: { name: "First", color: "blue", userId },
			});
			await tx.category.create({
				data: { name: "Second", color: "pink", userId },
			});
			throw new TRPCError({ code: "BAD_REQUEST", message: "midway failure" });
		}),
	),
	readOwnWrites: protectedProcedure.mutation(({ ctx }) =>
		userTransaction(ctx.db, ctx.session.user.id, async (tx) => {
			const userId = ctx.session.user.id;
			const made = await tx.category.create({
				data: { name: "Mine", color: "blue", userId },
			});
			const seen = await tx.category.findUnique({ where: { id: made.id } });
			await tx.category.update({
				where: { id: made.id },
				data: { name: "Renamed" },
			});
			const renamed = await tx.category.findUnique({ where: { id: made.id } });
			const counted = await tx.category.count({ where: { userId } });
			// The row was last written by this very transaction, not a committed one.
			const [own] = await tx.$queryRaw<{ own: boolean }[]>`
				SELECT xmin::text = pg_current_xact_id()::xid::text AS own
				FROM "category" WHERE id = ${made.id}`;
			return {
				seen: seen?.name,
				renamed: renamed?.name,
				counted,
				writtenByThisTransaction: own?.own,
			};
		}),
	),
	touchOther: protectedProcedure
		.input((value: unknown) => value as { otherCategoryId: string })
		.mutation(({ ctx, input }) =>
			userTransaction(ctx.db, ctx.session.user.id, async (tx) => {
				const role = await tx.$queryRaw<
					{ role: string }[]
				>`SELECT current_user AS role`;
				const peeked = await tx.category.findUnique({
					where: { id: input.otherCategoryId },
				});
				const updated = await tx.category.updateMany({
					where: { id: input.otherCategoryId },
					data: { name: "Hijacked" },
				});
				return { role: role[0]?.role, peeked, updated: updated.count };
			}),
		),
	plantForOther: protectedProcedure
		.input((value: unknown) => value as { otherUserId: string })
		.mutation(({ ctx, input }) =>
			userTransaction(ctx.db, ctx.session.user.id, (tx) =>
				tx.category.create({
					data: { name: "Planted", color: "pink", userId: input.otherUserId },
				}),
			),
		),
});

const callerFor = (userId: string) =>
	createCallerFactory(probe)({
		session: makeSession({ id: userId }),
		db: adminDb,
		headers: new Headers(),
	});

const namesOf = (userId: string) =>
	adminDb.category
		.findMany({ where: { userId }, orderBy: { name: "asc" } })
		.then((rows) => rows.map((row) => row.name));

describe("userTransaction on the protected procedure's scoped client", () => {
	it("leaves no rows when the work throws after two writes", async () => {
		const { user } = await createTestUser();

		await expect(callerFor(user.id).writeTwoThenThrow()).rejects.toThrow(
			"midway failure",
		);

		expect(await namesOf(user.id)).toEqual([]);
	});

	it("reads its own writes inside the transaction", async () => {
		const { user } = await createTestUser();

		const result = await callerFor(user.id).readOwnWrites();

		expect(result).toEqual({
			seen: "Mine",
			renamed: "Renamed",
			counted: 1,
			writtenByThisTransaction: true,
		});
		expect(await namesOf(user.id)).toEqual(["Renamed"]);
	});

	it("still enforces RLS on every query inside it", async () => {
		const alice = await createTestUser();
		const bob = await createTestUser();
		const bobCategory = await adminDb.category.create({
			data: { name: "Rent", color: "blue", userId: bob.user.id },
		});

		const result = await callerFor(alice.user.id).touchOther({
			otherCategoryId: bobCategory.id,
		});

		expect(result).toEqual({
			role: "retrospend_app",
			peeked: null,
			updated: 0,
		});
		await expect(
			callerFor(alice.user.id).plantForOther({ otherUserId: bob.user.id }),
		).rejects.toThrow(/row-level security/);
		expect(await namesOf(bob.user.id)).toEqual(["Rent"]);
	});
});

describe("account edits through the web router", () => {
	beforeAll(seedArsRates);

	it("wealth.updateAsset finishes well under the 5 s transaction timeout", async () => {
		const { user } = await arsUser();
		const id = await openAccount(user.id, "Savings", "CASH", "ARS", 1000);
		const caller = createCallerFactory(wealthRouter)({
			session: makeSession({ id: user.id }),
			db: adminDb,
			headers: new Headers(),
		});

		const started = Date.now();
		await caller.updateAsset({
			id,
			name: "Renamed savings",
			type: "CASH",
			currency: "ARS",
			balance: 1500,
			isLiquid: true,
		});

		expect(Date.now() - started).toBeLessThan(3000);
		const account = await adminDb.assetAccount.findUniqueOrThrow({
			where: { id },
		});
		expect(account.name).toBe("Renamed savings");
		expect(await balanceOf(id)).toBe("1500");
	});
});

describe("previews", () => {
	beforeAll(seedArsRates);

	it("a dry run leaves no rows and no event", async () => {
		const { user } = await arsUser();
		const id = await openAccount(user.id, "Savings", "CASH", "ARS", 1000);
		const eventsBefore = await adminDb.apiEvent.count({
			where: { userId: user.id },
		});
		const legsBefore = await adminDb.accountLeg.count({
			where: { accountId: id },
		});

		const preview = await forUser(user.id).preview(updateBalance, {
			accountId: id,
			balance: "990",
		});

		expect(preview.changes.length).toBeGreaterThan(0);
		expect(await balanceOf(id)).toBe("1000");
		expect(await adminDb.accountLeg.count({ where: { accountId: id } })).toBe(
			legsBefore,
		);
		expect(await adminDb.apiEvent.count({ where: { userId: user.id } })).toBe(
			eventsBefore,
		);
	});
});
