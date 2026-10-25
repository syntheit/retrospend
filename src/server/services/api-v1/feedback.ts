import type { SubmitFeedback } from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import * as z from "zod";
import { db } from "~/server/db";
import { assertAdmin } from "./admin";
import { decodeCursor, encodeCursor } from "./cursor";
import type { LedgerCaller } from "./money-op";
import { trpcFeedback } from "./trpc-bridge";

/**
 * v1 adapters for POST /feedback and the admin feedback inbox. Sending is
 * the web's submit procedure (hourly limit, admin email). The inbox is the
 * admin procedures; only the note is written here, because the procedure
 * trims it and v1 keeps user text exactly as sent.
 */

export async function submit(caller: LedgerCaller, input: SubmitFeedback) {
	await (await trpcFeedback(caller)).submit(input);
	return { ok: true as const };
}

const idKey = z.object({ id: z.string() });

type Status = "unread" | "read" | "archived";

export async function listInbox(
	caller: LedgerCaller,
	q: { status?: Status; cursor?: string; limit: number },
) {
	assertAdmin(caller);
	const after = decodeCursor(q.cursor, idKey);
	const page = await (await trpcFeedback(caller)).list({
		status: q.status,
		limit: q.limit,
		cursor: after?.id,
	});
	return {
		items: page.items.map((f) => ({
			id: f.id,
			message: f.message,
			status: f.status as Status,
			adminNote: f.adminNote,
			pageUrl: f.pageUrl,
			userAgent: f.userAgent,
			viewportSize: f.viewportSize,
			appVersion: f.appVersion,
			createdAt: f.createdAt.toISOString(),
			user: { id: f.user.id, name: f.user.name, email: f.user.email },
		})),
		nextCursor: page.nextCursor ? encodeCursor({ id: page.nextCursor }) : null,
		counts: page.counts,
	};
}

async function requireFeedback(id: string) {
	const found = await db.feedback.findUnique({ where: { id }, select: { id: true } });
	if (!found)
		throw new TRPCError({ code: "NOT_FOUND", message: "Feedback not found" });
}

export async function setStatus(
	caller: LedgerCaller,
	input: { id: string; status: Status },
) {
	assertAdmin(caller);
	await requireFeedback(input.id);
	await (await trpcFeedback(caller)).updateStatus(input);
	return { ok: true as const };
}

export async function setNote(
	caller: LedgerCaller,
	input: { id: string; note: string | null },
) {
	assertAdmin(caller);
	await requireFeedback(input.id);
	await db.feedback.update({
		where: { id: input.id },
		data: { adminNote: input.note },
	});
	return { ok: true as const };
}

export async function remove(caller: LedgerCaller, id: string) {
	assertAdmin(caller);
	await requireFeedback(id);
	await (await trpcFeedback(caller)).delete({ id });
	return { ok: true as const };
}
