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
                Sent by <span style="color: ${colors.primary}; font-weight: 600;">Retrospend</span> &mdash; the financial multitool
              </p>
              ${
								env.NEXT_PUBLIC_APP_URL
									? `<p style="margin: 8px 0 0 0; font-size: 13px; text-align: center;"><a href="${env.NEXT_PUBLIC_APP_URL}" style="color: ${colors.primary}; text-decoration: none;">${env.NEXT_PUBLIC_APP_URL}</a></p>`
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
