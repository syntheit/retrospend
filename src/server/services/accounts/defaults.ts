/**
 * Default account per currency (MONEY-MOVES §2.1, "Use for new ARS
 * entries"): what money sheets prefill as the account chip. Only a prefill:
 * a move touches an account only when the user leaves it picked (N75).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { userTransaction } from "~/server/db-tx";
import type { PrismaClient } from "~prisma";

const stored = z.record(z.string(), z.string());

export async function defaultAccounts(
	db: PrismaClient,
	userId: string,
): Promise<Record<string, string>> {
	const user = await db.user.findUnique({
		where: { id: userId },
		select: { defaultAccounts: true },
	});
	const parsed = stored.safeParse(user?.defaultAccounts ?? {});
	return parsed.success ? parsed.data : {};
}

/** Sets (or with null clears) the default account for one currency; it must be an open account in that currency. */
export async function setDefaultAccount(
	db: PrismaClient,
	userId: string,
	currency: string,
	accountId: string | null,
): Promise<Record<string, string>> {
	return userTransaction(db, userId, async (tx) => {
		if (accountId) {
			const account = await tx.assetAccount.findFirst({
				where: { id: accountId, userId, closedAt: null },
				select: { currency: true },
			});
			if (!account || account.currency !== currency) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Pick an open ${currency} account`,
				});
			}
		}
		const user = await tx.user.findUniqueOrThrow({
			where: { id: userId },
			select: { defaultAccounts: true },
		});
		const parsed = stored.safeParse(user.defaultAccounts ?? {});
		const next = { ...(parsed.success ? parsed.data : {}) };
		if (accountId) next[currency] = accountId;
		else delete next[currency];
		await tx.user.update({
			where: { id: userId },
			data: { defaultAccounts: next },
		});
		return next;
	});
}
