import type { InviteCodeDto } from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import * as z from "zod";
import { db } from "~/server/db";
import { isAllowAllUsersToGenerateInvitesEnabled } from "~/server/services/settings";
import type { Prisma } from "~prisma";
import { assertAdmin } from "./admin";
import { decodeCursor, toPage } from "./cursor";
import type { LedgerCaller } from "./money-op";
import { trpcInvite } from "./trpc-bridge";

/**
 * v1 adapters for /invite-codes (your own) and /admin/invite-codes (all).
 * Creating and deleting run the invite router's procedures, which check
 * the "everyone may invite" setting and the owner. Lists are read here with
 * a real cursor; the web lists by page number.
 */

const include = {
	createdBy: { select: { username: true, name: true } },
	usedBy: { select: { username: true, name: true } },
} satisfies Prisma.InviteCodeInclude;

type Row = Prisma.InviteCodeGetPayload<{ include: typeof include }>;

function toDto(row: Row): InviteCodeDto {
	return {
		id: row.id,
		code: row.code,
		state: row.usedAt ? "used" : "active",
		isActive: row.isActive,
		createdAt: row.createdAt.toISOString(),
		usedAt: row.usedAt?.toISOString() ?? null,
		expiresAt: row.expiresAt?.toISOString() ?? null,
		createdBy: row.createdBy,
		usedBy: row.usedBy,
	};
}

const createdCursor = z.object({ createdAt: z.iso.datetime(), id: z.string() });

type Query = {
	status: "all" | "active" | "used";
	cursor?: string;
	limit: number;
};

async function page(
	client: typeof db,
	where: Prisma.InviteCodeWhereInput,
	q: Query,
) {
	const after = decodeCursor(q.cursor, createdCursor);
	const rows = await client.inviteCode.findMany({
		where: {
			...where,
			...(q.status === "active" ? { usedAt: null } : {}),
			...(q.status === "used" ? { usedAt: { not: null } } : {}),
			...(after
				? {
						AND: [
							{
								OR: [
									{ createdAt: { lt: new Date(after.createdAt) } },
									{
										createdAt: new Date(after.createdAt),
										id: { lt: after.id },
									},
								],
							},
						],
					}
				: {}),
		},
		include,
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: q.limit + 1,
	});
	return toPage(
		rows,
		q.limit,
		(r) => ({ createdAt: r.createdAt.toISOString(), id: r.id }),
		toDto,
	);
}

async function mustAllowUsers() {
	if (!(await isAllowAllUsersToGenerateInvitesEnabled()))
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Invite code generation is not enabled for users",
		});
}

export async function listMine(caller: LedgerCaller, q: Query) {
	await mustAllowUsers();
	return page(caller.db, { createdById: caller.principal.userId }, q);
}

export async function createMine(caller: LedgerCaller): Promise<InviteCodeDto> {
	const made = await (await trpcInvite(caller)).generateUserCode();
	return byCode(made.code);
}

export async function deleteMine(caller: LedgerCaller, id: string) {
	await (await trpcInvite(caller)).deleteUserCode({ id });
	return { ok: true as const };
}

export async function listAll(caller: LedgerCaller, q: Query) {
	assertAdmin(caller);
	return page(db, {}, q);
}

export async function createAny(caller: LedgerCaller): Promise<InviteCodeDto> {
	assertAdmin(caller);
	const made = await (await trpcInvite(caller)).generate();
	return byCode(made.code);
}

export async function deleteAny(caller: LedgerCaller, id: string) {
	assertAdmin(caller);
	await (await trpcInvite(caller)).delete({ id });
	return { ok: true as const };
}

async function byCode(code: string): Promise<InviteCodeDto> {
	return toDto(
		await db.inviteCode.findUniqueOrThrow({ where: { code }, include }),
	);
}
