import {
	ERROR_REPORT_BATCH_MAX,
	type ErrorReportInput,
	FEEDBACK_SCREENSHOT_MAX_BYTES,
	feedbackDiagnosticsSchema,
	type SubmitFeedback,
	scrubReport,
} from "@retrospend/api-contract";
import {
	SealedTextError,
	stripUserTextControls,
} from "@retrospend/api-contract/common";
import { TRPCError } from "@trpc/server";
import * as z from "zod";
import { db } from "~/server/db";
import { recordAdminListView } from "~/server/services/admin-access.service";
import { processReceipt } from "~/server/image-processing";
import { openFeedbackScreenshotAsAdmin } from "~/server/services/feedback-screenshot.service";
import { uploadFile } from "~/server/storage";
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
	const sent = await (await trpcFeedback(caller)).submit(input);
	return { ok: true as const, id: sent.id };
}

/**
 * Where a screenshot lives: one fixed path per entry, outside the public
 * prefixes, so only admins read it. A new upload is written over the old one
 * (the store renames a finished temp file into place), so two uploads at the
 * same moment leave one file, never an orphan.
 */
export const screenshotPathOf = (id: string) => `feedback/${id}.webp`;

export async function attachScreenshot(
	caller: LedgerCaller,
	input: { id: string; file: File },
) {
	if (input.file.size > FEEDBACK_SCREENSHOT_MAX_BYTES)
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "File too large. Maximum 5MB.",
		});
	const userId = caller.principal.userId;
	// The sender only: another person's id is a 404.
	const row = await caller.db.feedback.findFirst({
		where: { id: input.id, userId },
		select: { id: true },
	});
	if (!row)
		throw new TRPCError({ code: "NOT_FOUND", message: "Feedback not found" });
	let processed: Buffer;
	try {
		processed = await processReceipt(
			Buffer.from(await input.file.arrayBuffer()),
		);
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: err instanceof Error ? err.message : "Invalid image format",
		});
	}
	const path = screenshotPathOf(row.id);
	await uploadFile(path, processed, "image/webp");
	await caller.db.feedback.update({
		where: { id: row.id },
		select: { id: true },
		data: { screenshotPath: path },
	});
	return { ok: true as const };
}

export async function readScreenshot(
	caller: LedgerCaller,
	id: string,
): Promise<File> {
	assertAdmin(caller);
	const stream = await openFeedbackScreenshotAsAdmin(
		caller.principal.userId,
		id,
	);
	if (!stream)
		throw new TRPCError({ code: "NOT_FOUND", message: "No screenshot" });
	const chunks: Buffer[] = [];
	try {
		for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	} catch {
		throw new TRPCError({ code: "NOT_FOUND", message: "No screenshot" });
	}
	return new File([new Uint8Array(Buffer.concat(chunks))], `${id}.webp`, {
		type: "image/webp",
	});
}

/** The newest reports kept per person; older ones are dropped as new arrive. */
const REPORTS_KEPT_PER_USER = 200;

/**
 * The scrubbed text with the characters a sealed column refuses taken out, or
 * null for text that starts with U+0001 (the marker of a sealed value, which
 * scrubReport leaves alone). Only that report is dropped: the app resends its
 * newest reports, so refusing the batch would silence the device.
 */
function storableText(text: string): string | null {
	try {
		return stripUserTextControls(text);
	} catch (error) {
		if (error instanceof SealedTextError) return null;
		throw error;
	}
}

/**
 * Stores what the app recorded. The app scrubs first; this scrubs again, so a
 * client that forgot cannot put an address or an amount in the table. The
 * message and stack are sealed on the instance key at rest (the admin reads
 * them), and the hourly sweep deletes a report after 30 days. A report whose
 * text starts with U+0001 is skipped; the rest are stored.
 */
export async function submitErrorReports(
	caller: LedgerCaller,
	input: { reports: ErrorReportInput[] },
) {
	const userId = caller.principal.userId;
	const reports = input.reports.slice(0, ERROR_REPORT_BATCH_MAX);
	const rows = reports.map(scrubReport).flatMap((r) => {
		const message = storableText(r.message);
		const stack = r.stack ? storableText(r.stack) : null;
		if (message === null || (r.stack && stack === null)) return [];
		return [
			{
				userId,
				kind: r.kind,
				message,
				stack,
				screen: r.screen ?? null,
				appVersion: r.appVersion ?? null,
				build: r.build ?? null,
				os: r.os ?? null,
				device: r.device ?? null,
				occurredAt: new Date(r.occurredAt),
			},
		];
	});
	if (rows.length > 0) await caller.db.errorReport.createMany({ data: rows });
	const old = await caller.db.errorReport.findMany({
		where: { userId },
		orderBy: { createdAt: "desc" },
		skip: REPORTS_KEPT_PER_USER,
		select: { id: true },
	});
	if (old.length)
		await caller.db.errorReport.deleteMany({
			where: { id: { in: old.map((o) => o.id) }, userId },
		});
	return { ok: true as const, stored: rows.length };
}

export async function listErrorReports(
	caller: LedgerCaller,
	q: { cursor?: string; limit: number },
) {
	assertAdmin(caller);
	const after = decodeCursor(q.cursor, idKey);
	const [rows, total] = await Promise.all([
		db.errorReport.findMany({
			take: q.limit + 1,
			...(after ? { cursor: { id: after.id }, skip: 1 } : {}),
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
			include: { user: { select: { id: true, name: true } } },
		}),
		db.errorReport.count(),
	]);
	await recordAdminListView(db, {
		adminId: caller.principal.userId,
		view: "error_reports",
		firstPage: !after,
	});
	const more = rows.length > q.limit;
	const items = more ? rows.slice(0, q.limit) : rows;
	const last = items[items.length - 1];
	return {
		items: items.map((r) => ({
			id: r.id,
			kind: r.kind as ErrorReportInput["kind"],
			message: r.message,
			stack: r.stack,
			screen: r.screen,
			appVersion: r.appVersion,
			build: r.build,
			os: r.os,
			device: r.device,
			occurredAt: r.occurredAt.toISOString(),
			createdAt: r.createdAt.toISOString(),
			user: { id: r.user.id, name: r.user.name },
		})),
		nextCursor: more && last ? encodeCursor({ id: last.id }) : null,
		total,
	};
}

export async function removeErrorReport(caller: LedgerCaller, id: string) {
	assertAdmin(caller);
	const found = await db.errorReport.findUnique({
		where: { id },
		select: { id: true },
	});
	if (!found)
		throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
	// No text is read back: the delete has committed by the time a row is opened.
	await db.errorReport.delete({ where: { id }, select: { id: true } });
	return { ok: true as const };
}

const idKey = z.object({ id: z.string() });

function diagnosticsOf(value: unknown) {
	const parsed = feedbackDiagnosticsSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

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
			category: f.category as "bug" | "idea" | "other",
			hasScreenshot: f.screenshotPath !== null,
			diagnostics: diagnosticsOf(f.diagnostics),
			createdAt: f.createdAt.toISOString(),
			user: { id: f.user.id, name: f.user.name, email: f.user.email },
		})),
		nextCursor: page.nextCursor ? encodeCursor({ id: page.nextCursor }) : null,
		counts: page.counts,
	};
}

async function requireFeedback(id: string) {
	const found = await db.feedback.findUnique({
		where: { id },
		select: { id: true },
	});
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
		select: { id: true },
		data: { adminNote: input.note },
	});
	return { ok: true as const };
}

export async function remove(caller: LedgerCaller, id: string) {
	assertAdmin(caller);
	await requireFeedback(id);
	// The procedure deletes the screenshot with the entry.
	await (await trpcFeedback(caller)).delete({ id });
	return { ok: true as const };
}
