import {
	type ErrorReportInput,
	type FeedbackDiagnostics,
	type SubmitFeedback,
	scrubScreen,
} from "@retrospend/api-contract";

export type FeedbackCategory = SubmitFeedback["category"];

/** How many recent app errors go with diagnostics. */
export const DIAGNOSTIC_ERRORS = 5;

export interface AppFacts {
	appVersion?: string;
	build?: string;
	os?: string;
	device?: string;
}

/**
 * What "Include diagnostics" sends: the app and phone facts, the language,
 * the server's version and the newest recent app errors. Never an expense,
 * an amount, a name or an address.
 */
export function collectDiagnostics(input: {
	facts: AppFacts;
	locale: string;
	serverVersion?: string;
	recentErrors: ErrorReportInput[];
}): FeedbackDiagnostics {
	return {
		...input.facts,
		locale: input.locale,
		serverVersion: input.serverVersion,
		recentErrors: input.recentErrors.slice(0, DIAGNOSTIC_ERRORS),
	};
}

/** A diagnostics line for the preview: which fact, and its value. */
export interface DiagnosticRow {
	key: "app" | "system" | "device" | "language" | "server" | "errors";
	value: string;
}

export function diagnosticRows(d: FeedbackDiagnostics): DiagnosticRow[] {
	const rows: DiagnosticRow[] = [];
	if (d.appVersion)
		rows.push({
			key: "app",
			value: d.build ? `${d.appVersion} (${d.build})` : d.appVersion,
		});
	if (d.os) rows.push({ key: "system", value: d.os });
	if (d.device) rows.push({ key: "device", value: d.device });
	if (d.locale) rows.push({ key: "language", value: d.locale });
	if (d.serverVersion) rows.push({ key: "server", value: d.serverVersion });
	rows.push({ key: "errors", value: String(d.recentErrors?.length ?? 0) });
	return rows;
}

/** The request body. Without diagnostics it carries the message, category and screen, nothing else. */
export function buildFeedback(input: {
	message: string;
	category: FeedbackCategory;
	screen?: string;
	diagnostics: FeedbackDiagnostics | null;
	viewport?: { width: number; height: number };
}): SubmitFeedback {
	const d = input.diagnostics;
	return {
		message: input.message.trim(),
		category: input.category,
		pageUrl: `app:${scrubScreen(input.screen ?? "/")}`,
		...(d
			? {
					diagnostics: d,
					appVersion: d.appVersion,
					userAgent: [
						`Retrospend/${d.appVersion ?? "unknown"}`,
						`(${[d.os, d.device].filter(Boolean).join("; ")})`,
					].join(" "),
					viewportSize: input.viewport
						? `${Math.round(input.viewport.width)}x${Math.round(input.viewport.height)}`
						: undefined,
				}
			: {}),
	};
}
