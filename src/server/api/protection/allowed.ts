/**
 * What an account with advanced protection on may call. Deny by default: a
 * route that is not named here is refused with `protected_account`, so a
 * forgotten route fails closed instead of computing over rows that moved to
 * the vault. Each entry says why it is safe.
 *
 * The rule for adding one is written with the v1 list, in
 * packages/api-contract/src/protection/v1-allowed.ts, and holds for tRPC too.
 * The protection block in v1/__tests__/completeness.test.ts and
 * __tests__/walk.test.ts keep both lists honest.
 *
 * Left out on purpose, with their sealed settings record in mind: the general
 * settings (settings.getGeneral and updateGeneral), page settings, analytics
 * category preferences and favorite rates.
 */

/** `{ key: reason }` for several keys that share one reason. */
function entries(
	keys: readonly string[],
	reason: string,
): Record<string, string> {
	return Object.fromEntries(keys.map((key) => [key, reason]));
}

const PUBLIC_TRPC =
	"Public: no session needed, touches no personal ledger data";
const ADMIN = "Admin: acts on the server and other accounts, reads no ledger";

/** tRPC paths (`router.procedure`). */
export const TRPC_ALLOWED: Readonly<Record<string, string>> = {
	// Today's public procedures. A signed-in account reaches them too, so each
	// one is named. project.publicPageView and the guest and claim links read
	// shared project data under a link's own authority, never the caller's.
	...entries(
		[
			"auth.getAppFeatures",
			"auth.verifyEmail",
			"auth.requestPasswordReset",
			"auth.resetPassword",
			"auth.confirmEmailChange",
			"auth.revertEmailChange",
			"exchangeRate.getRate",
			"notification.unsubscribe",
			"notification.unsubscribeAll",
			"invite.validate",
			"guest.validateLink",
			"guest.register",
			"guest.resume",
			"system.getFeatureFlags",
			"profile.publicProfile",
			"project.publicPageView",
			"settings.getInviteOnlyEnabled",
			"claim.info",
			"claim.projectGhosts",
			"claim.linkGuestToGhost",
		],
		PUBLIC_TRPC,
	),

	// Identity and profile.
	"auth.recordConsent": "Identity: stores the consent on the user row",
	"auth.resendVerificationEmail": "Identity: sends the verification email",
	"user.updateProfile": "Identity: name, username, email and password",
	"user.previewAccountDeletion":
		"Identity: counts of shared projects and people the delete changes, no ledger",
	"user.deleteAccount": "Identity: leaving must stay possible",
	"profile.update": "Identity: name, username and email",
	"profile.changePassword": "Identity: password",
	"profile.getPendingEmail": "Identity: a pending email change",
	"profile.cancelPendingEmailChange": "Identity: a pending email change",
	"profile.getMyAvatar": "Identity: the profile picture",
	"profile.getBackgroundSettings": "Display: the profile page background",
	"profile.saveBackgroundSettings": "Display: the profile page background",

	// Sessions and security.
	"deviceSession.list": "Security: the account's own sessions",
	"deviceSession.disconnect":
		"Security: ends one of the account's own sessions",
	"adminAccess.list":
		"Security: who looked at the account, from the access log",

	// Notification preferences.
	"notification.getPreferences": "Settings: which notices go where",
	"notification.updatePreferences": "Settings: which notices go where",

	// Public rates and server info.
	"exchangeRate.getAllRates": "Public rates: shared exchange rates",
	"exchangeRate.getLastSync": "Public rates: when the shared rates last synced",
	"exchangeRate.getRatesForCurrency": "Public rates: shared exchange rates",
	"system.getWorkerStatus": "Server info: the background worker's heartbeat",
	"system.checkSidecarStatus": "Server info: whether the sidecar is up",
	"system.checkImporterStatus": "Server info: whether the importer is up",

	// Admin routes.
	...entries(
		[
			"admin.deleteGuestSession",
			"admin.deleteShadowProfile",
			"admin.deleteUser",
			"admin.disableUser",
			"admin.enableUser",
			"admin.generatePasswordResetLink",
			"admin.getAiSettings",
			"admin.getAiUsageStats",
			"admin.getAuditLogPrivacyMode",
			"admin.getBackupStatus",
			"admin.getEventLogs",
			"admin.getEventLogsCursor",
			"admin.getOverview",
			"admin.getServerStats",
			"admin.getSettings",
			"admin.getStats",
			"admin.listGuestSessions",
			"admin.listShadowProfiles",
			"admin.listUsers",
			"admin.markEmailVerified",
			"admin.removeUserAvatar",
			"admin.resetPassword",
			"admin.sendTestEmail",
			"admin.setUserAiAccess",
			"admin.toggleEmailVerification",
			"admin.triggerBackup",
			"admin.updateAiSettings",
			"admin.updateSettings",
			"system.getAutoPostStatus",
			"exchangeRate.syncNow",
			"feedback.list",
			"feedback.unreadCount",
			"feedback.updateStatus",
			"feedback.addNote",
			"feedback.delete",
			"feedback.errorReports",
			"feedback.deleteErrorReport",
			"invite.list",
			"invite.generate",
			"invite.delete",
		],
		ADMIN,
	),
};

/**
 * API v1 routes (`METHOD /path`, as the contract names them) live with the
 * contract, which documents them in openapi.json. A public route
 * (GET /server-info) is never checked, so it is not listed.
 */
export { V1_ALLOWED } from "@retrospend/api-contract/protection-allowed";
