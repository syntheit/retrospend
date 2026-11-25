/**
 * The words of the account and system emails, and every subject line. These
 * are English only: they go to someone who has no language on file yet (a new
 * sign-up, an address being confirmed) or to an admin. The emails about shared
 * costs are different: their words come from the notificationText catalog in
 * the reader's language (see notification-text.ts).
 *
 * Sentence case, one short sentence where possible, no em dashes. A name or an
 * address is passed in by the template, never typed here.
 */
export const emailSubject = {
	verifyEmail: "Verify your email",
	passwordReset: "Reset your password",
	passwordResetCode: "Your password reset code",
	passwordChanged: "Your password was changed",
	protectionEnabled: "Advanced protection keys were created",
	passwordRecovered: "Your password was reset with your recovery key",
	recoveryKeyReplaced: "Your recovery key was replaced",
	emailChangeConfirm: "Confirm your new email",
	emailChangeAlert: "Email change requested",
	smtpTest: "SMTP test",
	feedback: (name: string) => `New feedback from ${name}`,
	shadowInvite: (name: string) => `${name} invited you to Retrospend`,
	notification: (title: string) => `Retrospend: ${title}`,
} as const;

export const emailCopy = {
	fallbackLink: "Or copy this link into your browser.",
	verifyEmail: {
		title: "Verify your email",
		body: "Confirm this address to start using Retrospend.",
		button: "Verify email",
		expiry: "The link expires in 24 hours.",
	},
	passwordReset: {
		title: "Reset your password",
		body: "Someone asked to reset your password. If it was not you, ignore this email.",
		button: "Reset password",
		expiry: "The link expires in 1 hour.",
	},
	passwordResetCode: {
		title: "Your reset code",
		body: "Enter this code in the app to start resetting your password. If it was not you, ignore this email.",
		expiry: "The code expires in 15 minutes.",
	},
	passwordChanged: {
		title: "Password changed",
		body: "Your Retrospend password was changed.",
		notice:
			"If it was not you, reset your password now or contact your administrator.",
	},
	protectionEnabled: {
		title: "Advanced protection keys created",
		body: "Your Retrospend account now signs in with a password that never leaves your devices, and you were signed out everywhere else.",
		notice:
			"If it was not you, reset your password now or contact your administrator.",
	},
	passwordRecovered: {
		title: "Password reset with your recovery key",
		body: "Your Retrospend password was reset with your recovery key. You were signed out everywhere, and your access tokens were removed.",
		notice:
			"If it was not you, contact your administrator now. Your recovery key may be exposed.",
	},
	recoveryKeyReplaced: {
		title: "Recovery key replaced",
		body: "The recovery key of your Retrospend account was replaced. The old key no longer works.",
		notice:
			"If it was not you, sign in and make a new recovery key, or reset your password.",
	},
	emailChangeConfirm: {
		title: "Confirm your new email",
		body: (email: string) => `Confirm ${email} as your Retrospend email.`,
		button: "Confirm email",
		expiry: "The link expires in 24 hours.",
		ignore: "If you did not ask for this, ignore this email.",
	},
	emailChangeAlert: {
		title: "Email change requested",
		body: (email: string) =>
			`Someone asked to change your Retrospend email to ${email}.`,
		notice: "If it was not you, cancel the change now and reset your password.",
		button: "Cancel email change",
	},
	feedback: {
		title: "New feedback",
		body: (name: string) => `${name} sent feedback.`,
		page: "Page",
		time: "Time",
		button: "Open admin",
	},
	shadowInvite: {
		title: "You are invited",
		body: (name: string) => `${name} wants to share expenses with you.`,
		button: "Join Retrospend",
		note: "Sign up with this email address to see your balance.",
	},
	smtpTest: {
		title: "Email is working",
		body: "Your SMTP settings are correct.",
	},
} as const;
