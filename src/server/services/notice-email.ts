import { emailSubject } from "~/server/email-copy";
import { notificationEmail } from "~/server/email-templates";
import {
	buildEmailLabels,
	type NoticeReader,
	type NoticeText,
} from "~/server/services/notification-text";

/**
 * A notice made into an email: the subject and the page, with the button and
 * footer labels in the reader's language. The words come from the notice
 * (notification-text.ts); the layout and the design tokens from the email
 * templates. The button carries the notice's own label only when it has a link.
 */
export async function renderNoticeEmail(
	text: Pick<NoticeText, "title" | "body" | "cta">,
	reader: NoticeReader,
	links: { ctaUrl?: string; unsubscribeUrl?: string } = {},
): Promise<{ subject: string; html: string }> {
	const { locale, ...labels } = await buildEmailLabels(reader);
	return {
		subject: emailSubject.notification(text.title),
		html: notificationEmail({
			title: text.title,
			body: text.body,
			labels,
			locale,
			ctaUrl: links.ctaUrl,
			ctaLabel: links.ctaUrl ? (text.cta ?? undefined) : undefined,
			unsubscribeUrl: links.unsubscribeUrl,
		}),
	};
}
