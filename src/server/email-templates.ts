import { env } from "~/env";

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

const colors = {
	background: "#f8f8fa",
	card: "#ffffff",
	textBase: "#2e2e33",
	textSecondary: "#52525b",
	textMuted: "#a1a1aa",
	primary: "#6b584d",
	primaryDark: "#5c4b42",
	border: "#e4e4e7",
	accent: "#6b584d",
	warningBg: "#fffbeb",
	warningBorder: "#fde68a",
	warningText: "#92400e",
};

const getBaseStyles = () => `
  <style>
    body { margin: 0; padding: 0; background-color: ${colors.background}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; -webkit-font-smoothing: antialiased; }
    table, td { border-collapse: collapse; }
  </style>
`;

/**
 * Base email template structure with fully inlined styles for email client compatibility.
 */
function baseEmailTemplate(
	title: string,
	content: string,
	preheader: string = "",
) {
	const appUrl = env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL;
	return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  ${getBaseStyles()}
</head>
<body style="margin: 0; padding: 0; background-color: ${colors.background}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <!-- Preheader -->
  <span style="display:none;font-size:1px;color:${colors.background};line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    ${escapeHtml(preheader)}
  </span>

  <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: ${colors.background};">
    <tr>
      <td align="center" style="padding: 48px 24px;">

        <!-- Card -->
        <table width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 560px; background-color: ${colors.card}; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); overflow: hidden;">

          <!-- Accent bar -->
          <tr>
            <td style="height: 4px; background-color: ${colors.accent};"></td>
          </tr>

          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 0 40px; text-align: center;">
              <p style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.5px; color: ${colors.primary};">RETROSPEND</p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 20px 40px 0 40px;">
              <hr style="border: none; border-top: 1px solid ${colors.border}; margin: 0;" />
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px 40px 40px 40px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #fafafa; border-top: 1px solid ${colors.border};">
              <p style="margin: 0 0 4px 0; font-size: 13px; line-height: 1.5; color: ${colors.textMuted}; text-align: center;">
                Sent by <span style="color: ${colors.primary}; font-weight: 600;">Retrospend</span> - the financial multitool
              </p>
              ${
								appUrl
									? `<p style="margin: 8px 0 0 0; font-size: 13px; text-align: center;"><a href="${appUrl}" style="color: ${colors.primary}; text-decoration: none;">${appUrl}</a></p>`
									: ""
							}
              <p style="margin: 12px 0 0 0; font-size: 11px; line-height: 1.5; color: #c4c4cc; text-align: center;">
                This is an automated message. Please do not reply directly.
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Generates an email verification HTML template.
 */
export function getVerificationEmailTemplate(verifyUrl: string) {
	const content = `
    <p style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${colors.textBase};">Welcome to Retrospend</p>
    <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: ${colors.textSecondary};">
      Please verify your email address to get started managing your finances.
    </p>

    <table width="100%" border="0" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding: 8px 0 32px 0;">
          <a href="${escapeHtml(verifyUrl)}" style="display: inline-block; padding: 14px 32px; background-color: ${colors.primary}; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; letter-spacing: 0.3px;">Verify Email Address</a>
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 6px 0; font-size: 13px; line-height: 1.5; color: ${colors.textMuted};">
      If the button doesn't work, copy and paste this link into your browser:
    </p>
    <p style="margin: 0 0 16px 0; font-size: 13px; word-break: break-all;">
      <a href="${escapeHtml(verifyUrl)}" style="color: ${colors.primary}; text-decoration: underline;">${escapeHtml(verifyUrl)}</a>
    </p>
    <p style="margin: 0; font-size: 13px; color: ${colors.textMuted};">This link will expire in 24 hours.</p>
  `;

	return baseEmailTemplate(
		"Verify your Retrospend Account",
		content,
		"Please verify your email address to get started managing your finances.",
	);
}

/**
 * Generates a password reset HTML template.
 */
export function getPasswordResetEmailTemplate(resetUrl: string) {
	const content = `
    <p style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${colors.textBase};">Reset Your Password</p>
    <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: ${colors.textSecondary};">
      We received a request to reset your password. If you didn't make this request, you can safely ignore this email.
    </p>

    <table width="100%" border="0" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding: 8px 0 32px 0;">
          <a href="${escapeHtml(resetUrl)}" style="display: inline-block; padding: 14px 32px; background-color: ${colors.primary}; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; letter-spacing: 0.3px;">Reset Password</a>
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 6px 0; font-size: 13px; line-height: 1.5; color: ${colors.textMuted};">
      If the button doesn't work, copy and paste this link into your browser:
    </p>
    <p style="margin: 0 0 16px 0; font-size: 13px; word-break: break-all;">
      <a href="${escapeHtml(resetUrl)}" style="color: ${colors.primary}; text-decoration: underline;">${escapeHtml(resetUrl)}</a>
    </p>
    <p style="margin: 0; font-size: 13px; color: ${colors.textMuted};">This link will expire in 1 hour.</p>
  `;

	return baseEmailTemplate(
		"Reset your Retrospend Password",
		content,
		"We received a request to reset your Retrospend password.",
	);
}

/**
 * Generates a security alert when a password is changed.
 */
export function getPasswordChangedAlertTemplate() {
	const content = `
    <p style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${colors.textBase};">Security Alert</p>
    <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: ${colors.textSecondary};">
      Your Retrospend password was recently changed.
    </p>

    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 8px;">
      <tr>
        <td style="padding: 16px 20px; background-color: ${colors.warningBg}; border: 1px solid ${colors.warningBorder}; border-radius: 8px;">
          <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: ${colors.warningText};">Did you make this change?</p>
          <p style="margin: 0; font-size: 14px; line-height: 1.6; color: ${colors.warningText};">
            If you did, you can safely ignore this email. If not, please contact your administrator immediately or reset your password.
          </p>
        </td>
      </tr>
    </table>
  `;

	return baseEmailTemplate(
		"Security Alert: Your Retrospend Password was Changed",
		content,
		"Your Retrospend password was recently changed.",
	);
}

/**
 * Generates a notification email for in-app notification types.
 * Optionally includes a one-click unsubscribe link in the footer.
 */
export function notificationEmail({
	title,
	body,
	unsubscribeUrl,
	ctaUrl,
	ctaLabel,
}: {
	title: string;
	body: string;
	unsubscribeUrl?: string;
	ctaUrl?: string;
	ctaLabel?: string;
}) {
	const appUrl = env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "";
	const settingsUrl = appUrl ? `${appUrl}/settings` : null;
	const buttonUrl = ctaUrl ?? (appUrl ? appUrl + "/dashboard" : null);
	const buttonLabel = ctaLabel ?? "View in Retrospend";

	const content = `
    <p style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${colors.textBase};">${escapeHtml(title)}</p>
    <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: ${colors.textSecondary};">${escapeHtml(body)}</p>
    ${
			buttonUrl
				? `<table width="100%" border="0" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding: 8px 0 32px 0;">
          <a href="${escapeHtml(buttonUrl)}" style="display: inline-block; padding: 14px 32px; background-color: ${colors.primary}; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; letter-spacing: 0.3px;">${escapeHtml(buttonLabel)}</a>
        </td>
      </tr>
    </table>`
				: ""
		}
    <p style="margin: 0; font-size: 12px; color: ${colors.textMuted}; text-align: center;">
      ${settingsUrl ? `<a href="${escapeHtml(settingsUrl)}" style="color: ${colors.textMuted};">Manage notification preferences</a>` : ""}
      ${settingsUrl && unsubscribeUrl ? " &middot; " : ""}
      ${unsubscribeUrl ? `<a href="${escapeHtml(unsubscribeUrl)}" style="color: ${colors.textMuted};">Unsubscribe</a>` : ""}
    </p>
  `;

	return baseEmailTemplate(`Retrospend: ${title}`, content, body);
}

/**
 * Generates an email sent to the NEW email address to confirm the change.
 */
export function getEmailChangeVerificationTemplate(
	verifyUrl: string,
	newEmail: string,
) {
	const content = `
    <p style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${colors.textBase};">Confirm Your New Email</p>
    <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: ${colors.textSecondary};">
      You requested to change your Retrospend email to <strong>${escapeHtml(newEmail)}</strong>. Click below to confirm this change.
    </p>

    <table width="100%" border="0" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding: 8px 0 32px 0;">
          <a href="${escapeHtml(verifyUrl)}" style="display: inline-block; padding: 14px 32px; background-color: ${colors.primary}; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; letter-spacing: 0.3px;">Confirm Email Change</a>
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 6px 0; font-size: 13px; line-height: 1.5; color: ${colors.textMuted};">
      If the button doesn't work, copy and paste this link into your browser:
    </p>
    <p style="margin: 0 0 16px 0; font-size: 13px; word-break: break-all;">
      <a href="${escapeHtml(verifyUrl)}" style="color: ${colors.primary}; text-decoration: underline;">${escapeHtml(verifyUrl)}</a>
    </p>
    <p style="margin: 0; font-size: 13px; color: ${colors.textMuted};">This link will expire in 24 hours. If you didn't request this change, you can safely ignore this email.</p>
  `;

	return baseEmailTemplate(
		"Confirm Your New Email Address",
		content,
		"Please confirm your new email address for your Retrospend account.",
	);
}

/**
 * Generates a security alert email sent to the OLD email address when an email change is requested.
 */
export function getEmailChangeAlertTemplate(
	revertUrl: string,
	newEmail: string,
) {
	const content = `
    <p style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${colors.textBase};">Security Alert</p>
    <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: ${colors.textSecondary};">
      A request was made to change your Retrospend account email to <strong>${escapeHtml(newEmail)}</strong>.
    </p>
    <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: ${colors.textSecondary};">
      If this was you, no action is needed. The change will take effect once the new email is verified.
    </p>

    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
      <tr>
        <td style="padding: 16px 20px; background-color: ${colors.warningBg}; border: 1px solid ${colors.warningBorder}; border-radius: 8px;">
          <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: ${colors.warningText};">Didn't request this change?</p>
          <p style="margin: 0; font-size: 14px; line-height: 1.6; color: ${colors.warningText};">
            If you didn't request this, click the button below immediately to cancel the change and secure your account. We recommend resetting your password afterwards.
          </p>
        </td>
      </tr>
    </table>

    <table width="100%" border="0" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding: 8px 0 32px 0;">
          <a href="${escapeHtml(revertUrl)}" style="display: inline-block; padding: 14px 32px; background-color: #dc2626; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; letter-spacing: 0.3px;">Cancel Email Change</a>
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 6px 0; font-size: 13px; line-height: 1.5; color: ${colors.textMuted};">
      If the button doesn't work, copy and paste this link into your browser:
    </p>
    <p style="margin: 0; font-size: 13px; word-break: break-all;">
      <a href="${escapeHtml(revertUrl)}" style="color: ${colors.primary}; text-decoration: underline;">${escapeHtml(revertUrl)}</a>
    </p>
  `;

	return baseEmailTemplate(
		"Security Alert: Email Change Requested",
		content,
		"Someone requested to change your Retrospend account email. If this wasn't you, take action immediately.",
	);
}

/**
 * Generates a feedback notification email for admins.
 */
export function getFeedbackNotificationTemplate(
	userName: string,
	message: string,
	pageUrl: string,
	timestamp: string,
) {
	const appUrl = env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "";
	const adminUrl = appUrl ? `${appUrl}/admin` : null;

	const content = `
    <p style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${colors.textBase};">New Feedback Received</p>
    <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: ${colors.textSecondary};">
      <strong>${escapeHtml(userName)}</strong> submitted feedback:
    </p>

    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
      <tr>
        <td style="padding: 16px 20px; background-color: #f4f4f5; border: 1px solid ${colors.border}; border-radius: 8px;">
          <p style="margin: 0; font-size: 14px; line-height: 1.6; color: ${colors.textBase}; white-space: pre-wrap;">${escapeHtml(message)}</p>
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 4px 0; font-size: 13px; color: ${colors.textMuted};">Page: ${escapeHtml(pageUrl)}</p>
    <p style="margin: 0 0 24px 0; font-size: 13px; color: ${colors.textMuted};">Time: ${escapeHtml(timestamp)}</p>

    ${
			adminUrl
				? `<table width="100%" border="0" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding: 8px 0 16px 0;">
          <a href="${escapeHtml(adminUrl)}" style="display: inline-block; padding: 14px 32px; background-color: ${colors.primary}; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; letter-spacing: 0.3px;">View in Admin Panel</a>
        </td>
      </tr>
    </table>`
				: ""
		}
  `;

	return baseEmailTemplate(
		`New feedback from ${userName}`,
		content,
		`${userName} submitted feedback: ${message.slice(0, 100)}`,
	);
}

/**
 * Generates an invitation email for someone added as a shadow profile.
 * Sent when a user creates a shadow with an email address (splitting expenses).
 */
export function getShadowInviteEmailTemplate(
	creatorName: string,
	signupUrl: string,
) {
	const content = `
    <p style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${colors.textBase};">You've been invited to Retrospend</p>
    <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: ${colors.textSecondary};">
      ${escapeHtml(creatorName)} wants to share expenses with you on Retrospend. Create a free account to view your balance, settle up, and take control of your finances.
    </p>

    <table width="100%" border="0" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding: 8px 0 32px 0;">
          <a href="${escapeHtml(signupUrl)}" style="display: inline-block; padding: 14px 32px; background-color: ${colors.primary}; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; letter-spacing: 0.3px;">Join Retrospend</a>
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 16px 0; font-size: 14px; font-weight: 600; color: ${colors.textBase};">Your free account includes:</p>

    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
      <tr>
        <td style="padding: 4px 0; font-size: 14px; line-height: 1.6; color: ${colors.textSecondary};">
          &#8226;&nbsp; View shared expenses and settle up with friends
        </td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 14px; line-height: 1.6; color: ${colors.textSecondary};">
          &#8226;&nbsp; Track personal spending with smart categorization
        </td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 14px; line-height: 1.6; color: ${colors.textSecondary};">
          &#8226;&nbsp; Set budgets and get real-time spending insights
        </td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 14px; line-height: 1.6; color: ${colors.textSecondary};">
          &#8226;&nbsp; Track your net worth and wealth over time
        </td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 14px; line-height: 1.6; color: ${colors.textSecondary};">
          &#8226;&nbsp; Multi-currency support with live exchange rates
        </td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 14px; line-height: 1.6; color: ${colors.textSecondary};">
          &#8226;&nbsp; Import bank statements and scan receipts
        </td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 14px; line-height: 1.6; color: ${colors.textSecondary};">
          &#8226;&nbsp; Access from any device, anywhere
        </td>
      </tr>
    </table>

    <p style="margin: 0; font-size: 13px; color: ${colors.textMuted};">
      Your shared expense data will be automatically linked when you sign up with this email address.
    </p>
  `;

	return baseEmailTemplate(
		"You've been invited to Retrospend",
		content,
		`${creatorName} wants to share expenses with you on Retrospend. Join to view your balance and settle up.`,
	);
}

/**
 * Generates an SMTP test email template.
 */
export function getTestEmailTemplate() {
	const content = `
    <p style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${colors.textBase};">SMTP Test Successful</p>
    <p style="margin: 0 0 12px 0; font-size: 15px; line-height: 1.6; color: ${colors.textSecondary};">
      Your SMTP configuration is working correctly.
    </p>
    <p style="margin: 0; font-size: 15px; line-height: 1.6; color: ${colors.textSecondary};">
      Email features like account verification and password resets are now available.
    </p>
  `;

	return baseEmailTemplate(
		"Retrospend SMTP Test",
		content,
		"Your SMTP configuration for Retrospend is working correctly.",
	);
}
