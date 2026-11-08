import { env } from "~/env";
import { emailCopy, emailSubject } from "~/server/email-copy";
import { emailTheme as theme } from "~/server/email-theme";

/**
 * Transactional email layout. Email clients need tables and inline styles, so
 * every value is written into the element it styles. The values themselves
 * are the design tokens (email-theme.ts), never literals: the page is the
 * `bg` tone, the card is `surface`, the button is `brand`. Flat, like the
 * app: no shadow, no accent stripe, no border around the card.
 */

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

const { color, font, type, space, radius } = theme;

function text(
	role: "body" | "small" | "meta",
	tone: "textSecondary" | "textMuted" | "text",
	extra = "",
) {
	return `font-size: ${type[role].size}px; line-height: ${type[role].lineHeight}; color: ${color[tone]}; ${extra}`;
}

function heading(value: string) {
	return `<p style="margin: 0 0 ${space[2]}px 0; font-size: ${type.title.size}px; line-height: ${type.title.lineHeight}; letter-spacing: ${type.title.tracking}em; font-weight: ${font.semibold}; color: ${color.text};">${escapeHtml(value)}</p>`;
}

function paragraph(value: string, bottom: number = space[6]) {
	return `<p style="margin: 0 0 ${bottom}px 0; ${text("body", "textSecondary")}">${value}</p>`;
}

function strong(value: string) {
	return `<strong style="font-weight: ${font.semibold}; color: ${color.text};">${escapeHtml(value)}</strong>`;
}

function button(
	label: string,
	url: string,
	tone: "brand" | "danger" = "brand",
	bottom: number = space[8],
) {
	const fill = tone === "danger" ? color.danger : color.brand;
	const ink = tone === "danger" ? color.onDanger : color.onBrand;
	return `<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
      <tr>
        <td align="center" style="padding: ${space[2]}px 0 ${bottom}px 0;">
          <a href="${escapeHtml(url)}" style="display: inline-block; padding: ${space[3]}px ${space[6]}px; background-color: ${fill}; color: ${ink}; text-decoration: none; border-radius: ${radius.control}px; font-size: ${type.body.size}px; line-height: ${type.body.lineHeight}; font-weight: ${font.medium};">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`;
}

/** The link as text, for a client that does not show the button. */
function fallbackLink(url: string, bottom: number = space[4]) {
	return `<p style="margin: 0 0 ${space[1]}px 0; ${text("small", "textMuted")}">${escapeHtml(emailCopy.fallbackLink)}</p>
    <p style="margin: 0 0 ${bottom}px 0; font-size: ${type.small.size}px; line-height: ${type.small.lineHeight}; word-break: break-all;">
      <a href="${escapeHtml(url)}" style="color: ${color.link}; text-decoration: underline;">${escapeHtml(url)}</a>
    </p>`;
}

/** The address as people say it: the host, without the scheme. */
function hostOf(url: string) {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

function meta(value: string, bottom: number = 0) {
	return `<p style="margin: 0 0 ${bottom}px 0; ${text("small", "textMuted")}">${escapeHtml(value)}</p>`;
}

/** What needs the reader: an attention fill, no border. */
function notice(value: string) {
	return `<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom: ${space[6]}px;">
      <tr>
        <td style="padding: ${space[4]}px; background-color: ${color.attentionBg}; border-radius: ${radius.panel}px; font-size: ${type.body.size}px; line-height: ${type.body.lineHeight}; color: ${color.attentionText};">${escapeHtml(value)}</td>
      </tr>
    </table>`;
}

/**
 * Base email structure with fully inlined styles for email client
 * compatibility.
 */
function baseEmailTemplate({
	title,
	content,
	preheader = "",
	locale = "en",
}: {
	title: string;
	content: string;
	preheader?: string;
	locale?: string;
}) {
	const appUrl = env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL;
	return `
<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${color.page}; font-family: ${font.stack}; -webkit-font-smoothing: antialiased;">
  <span style="display: none; font-size: 1px; color: ${color.page}; line-height: 1px; max-height: 0; max-width: 0; opacity: 0; overflow: hidden;">${escapeHtml(preheader)}</span>

  <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color: ${color.page}; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: ${space[12]}px ${space[4]}px;">
        <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width: 560px; background-color: ${color.card}; border-radius: ${radius.panel}px; border-collapse: separate;">
          <tr>
            <td style="padding: ${space[8]}px ${space[8]}px 0 ${space[8]}px;">
              <p style="margin: 0; font-size: ${type.section.size}px; line-height: ${type.section.lineHeight}; font-weight: ${font.semibold}; color: ${color.text};">Retrospend</p>
            </td>
          </tr>
          <tr>
            <td style="padding: ${space[6]}px ${space[8]}px ${space[8]}px ${space[8]}px;">
              ${content}
            </td>
          </tr>
          ${
						appUrl
							? `<tr>
            <td style="padding: ${space[4]}px ${space[8]}px; border-top: 1px solid ${color.line};">
              <p style="margin: 0; font-size: ${type.meta.size}px; line-height: ${type.meta.lineHeight};"><a href="${escapeHtml(appUrl)}" style="color: ${color.textMuted}; text-decoration: none;">${escapeHtml(hostOf(appUrl))}</a></p>
            </td>
          </tr>`
							: ""
					}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/** Email verification. */
export function getVerificationEmailTemplate(verifyUrl: string) {
	const copy = emailCopy.verifyEmail;
	const content = `
    ${heading(copy.title)}
    ${paragraph(escapeHtml(copy.body))}
    ${button(copy.button, verifyUrl)}
    ${fallbackLink(verifyUrl)}
    ${meta(copy.expiry)}
  `;
	return baseEmailTemplate({
		title: emailSubject.verifyEmail,
		content,
		preheader: copy.body,
	});
}

/** Password reset. */
export function getPasswordResetEmailTemplate(resetUrl: string) {
	const copy = emailCopy.passwordReset;
	const content = `
    ${heading(copy.title)}
    ${paragraph(escapeHtml(copy.body))}
    ${button(copy.button, resetUrl)}
    ${fallbackLink(resetUrl)}
    ${meta(copy.expiry)}
  `;
	return baseEmailTemplate({
		title: emailSubject.passwordReset,
		content,
		preheader: copy.body,
	});
}

/** Security alert after a password change. */
export function getPasswordChangedAlertTemplate() {
	const copy = emailCopy.passwordChanged;
	const content = `
    ${heading(copy.title)}
    ${paragraph(escapeHtml(copy.body))}
    ${notice(copy.notice)}
  `;
	return baseEmailTemplate({
		title: emailSubject.passwordChanged,
		content,
		preheader: copy.body,
	});
}

/**
 * A notice email for an in-app notification. The words (title, body, button
 * label) and the three footer labels come from the notificationText catalog,
 * in the reader's language. Optionally carries a one-click unsubscribe link.
 */
export function notificationEmail({
	title,
	body,
	labels,
	locale,
	unsubscribeUrl,
	ctaUrl,
	ctaLabel,
}: {
	title: string;
	body: string;
	labels: { view: string; manage: string; unsubscribe: string };
	locale?: string;
	unsubscribeUrl?: string;
	ctaUrl?: string;
	ctaLabel?: string;
}) {
	const appUrl = env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "";
	const settingsUrl = appUrl ? `${appUrl}/settings` : null;
	const buttonUrl = ctaUrl ?? (appUrl ? `${appUrl}/home` : null);
	const links = [
		settingsUrl ? { label: labels.manage, url: settingsUrl } : null,
		unsubscribeUrl ? { label: labels.unsubscribe, url: unsubscribeUrl } : null,
	].filter((link) => link !== null);

	const content = `
    ${heading(title)}
    ${paragraph(escapeHtml(body))}
    ${buttonUrl ? button(ctaLabel ?? labels.view, buttonUrl, "brand", space[6]) : ""}
    ${
			links.length > 0
				? `<p style="margin: 0; font-size: ${type.meta.size}px; line-height: ${type.meta.lineHeight}; color: ${color.textMuted}; text-align: center;">${links
						.map(
							(link) =>
								`<a href="${escapeHtml(link.url)}" style="color: ${color.textMuted};">${escapeHtml(link.label)}</a>`,
						)
						.join(" &middot; ")}</p>`
				: ""
		}
  `;

	return baseEmailTemplate({
		title: emailSubject.notification(title),
		content,
		preheader: body,
		locale,
	});
}

/** Sent to the new address to confirm an email change. */
export function getEmailChangeVerificationTemplate(
	verifyUrl: string,
	newEmail: string,
) {
	const copy = emailCopy.emailChangeConfirm;
	const content = `
    ${heading(copy.title)}
    ${paragraph(copy.body(strong(newEmail)))}
    ${button(copy.button, verifyUrl)}
    ${fallbackLink(verifyUrl)}
    ${meta(copy.expiry, space[1])}
    ${meta(copy.ignore)}
  `;
	return baseEmailTemplate({
		title: emailSubject.emailChangeConfirm,
		content,
		preheader: copy.body(newEmail),
	});
}

/** Security alert to the old address when an email change is requested. */
export function getEmailChangeAlertTemplate(
	revertUrl: string,
	newEmail: string,
) {
	const copy = emailCopy.emailChangeAlert;
	const content = `
    ${heading(copy.title)}
    ${paragraph(copy.body(strong(newEmail)))}
    ${notice(copy.notice)}
    ${button(copy.button, revertUrl, "danger")}
    ${fallbackLink(revertUrl, 0)}
  `;
	return baseEmailTemplate({
		title: emailSubject.emailChangeAlert,
		content,
		preheader: copy.body(newEmail),
	});
}

/** Feedback forwarded to admins. */
export function getFeedbackNotificationTemplate(
	userName: string,
	message: string,
	pageUrl: string,
	timestamp: string,
) {
	const copy = emailCopy.feedback;
	const appUrl = env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "";
	const adminUrl = appUrl ? `${appUrl}/admin` : null;

	const content = `
    ${heading(copy.title)}
    ${paragraph(copy.body(strong(userName)))}
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom: ${space[6]}px;">
      <tr>
        <td style="padding: ${space[4]}px; background-color: ${color.raised}; border-radius: ${radius.panel}px;">
          <p style="margin: 0; ${text("body", "text", "white-space: pre-wrap;")}">${escapeHtml(message)}</p>
        </td>
      </tr>
    </table>
    ${meta(`${copy.page}: ${pageUrl}`, space[1])}
    ${meta(`${copy.time}: ${timestamp}`, space[6])}
    ${adminUrl ? button(copy.button, adminUrl, "brand", space[2]) : ""}
  `;
	return baseEmailTemplate({
		title: emailSubject.feedback(userName),
		content,
		preheader: `${userName}: ${message.slice(0, 100)}`,
	});
}

/**
 * An invitation for someone added as a shadow profile with an email address
 * (splitting expenses).
 */
export function getShadowInviteEmailTemplate(
	creatorName: string,
	signupUrl: string,
) {
	const copy = emailCopy.shadowInvite;
	const content = `
    ${heading(copy.title)}
    ${paragraph(escapeHtml(copy.body(creatorName)))}
    ${button(copy.button, signupUrl)}
    ${meta(copy.note)}
  `;
	return baseEmailTemplate({
		title: emailSubject.shadowInvite(creatorName),
		content,
		preheader: copy.body(creatorName),
	});
}

/** The SMTP test an admin sends from settings. */
export function getTestEmailTemplate() {
	const copy = emailCopy.smtpTest;
	const content = `
    ${heading(copy.title)}
    ${paragraph(escapeHtml(copy.body), 0)}
  `;
	return baseEmailTemplate({
		title: emailSubject.smtpTest,
		content,
		preheader: copy.body,
	});
}
