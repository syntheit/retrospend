import {
	type FeedbackDiagnostics,
	feedbackDiagnosticsSchema,
} from "@retrospend/api-contract";

/** What the person chose to send with a piece of feedback; null when none or unreadable. */
export function diagnosticsOf(value: unknown): FeedbackDiagnostics | null {
	const parsed = feedbackDiagnosticsSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/** The first non-empty line of a message, for a list row. */
export function firstLine(message: string): string {
	return message.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
}

/** The screen the feedback was written on: the apps send `app:/budget`. */
export function pageName(pageUrl: string): string {
	return pageUrl.startsWith("app:") ? pageUrl.slice(4) : pageUrl;
}

/**
 * The platform: the phone's OS from its diagnostics, or "web" when the entry
 * came from a browser (the apps send a `Retrospend/` user agent, browsers do
 * not). Null when the sender gave no hint.
 */
export function platformOf(entry: {
	userAgent: string | null;
	diagnostics: FeedbackDiagnostics | null;
}): { os: string } | "web" | null {
	if (entry.diagnostics?.os) return { os: entry.diagnostics.os };
	if (entry.userAgent && !entry.userAgent.startsWith("Retrospend/"))
		return "web";
	return null;
}

/** The URL of a screenshot: an admin-only route, never a public file. */
export const screenshotUrl = (id: string) =>
	`/api/admin/feedback/${id}/screenshot`;
