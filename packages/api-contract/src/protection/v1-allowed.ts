/**
 * What an account with advanced protection on may call. Deny by default: a
 * route that is not named here is refused with `protected_account`, so a
 * forgotten route fails closed instead of computing over rows that moved to
 * the vault. Each entry says why it is safe.
 *
 * The rule for adding one (e2ee-f5 decision 7): every table the route reads or
 * writes is identity, settings, shared or public data, and no figure it
 * returns sums personal rows. In doubt, leave it out. The K PRs add the
 * routes they make safe. The protection block in
 * src/server/api/v1/__tests__/completeness.test.ts and
 * src/server/api/protection/__tests__/walk.test.ts keep the list honest.
 *
 * This is the one source for the v1 list: the server guard and the generated
 * openapi.json (`x-protected-account`) read it. The events feed has its own
 * list of event types (PROTECTED_FEED_TYPES in services/events/feed.ts). The
 * reasons are review notes and stay out of the published document. The list
 * has its own subpath (`@retrospend/api-contract/protection-allowed`) so the
 * mobile bundle does not carry it.
 *
 * Left out on purpose, with their sealed settings record in mind: the general
 * settings (settings.getGeneral and updateGeneral, v1 /settings carry monthly
 * income, its currency and default accounts), page settings, analytics
 * category preferences and favorite rates.
 */

/** `{ key: reason }` for several keys that share one reason. */
function entries(
	keys: readonly string[],
	reason: string,
): Record<string, string> {
	return Object.fromEntries(keys.map((key) => [key, reason]));
}

const ADMIN = "Admin: acts on the server and other accounts, reads no ledger";

/**
 * API v1 routes (`METHOD /path`, as the contract names them). A public route
 * (GET /server-info) is never checked, so it is not listed.
 */
export const V1_ALLOWED: Readonly<Record<string, string>> = {
	// Identity and profile.
	"GET /me": "Identity: the signed-in account's own row",
	"GET /profile": "Identity: the profile",
	"PATCH /profile": "Identity: name, username and email",
	"DELETE /profile/pending-email": "Identity: a pending email change",
	"PUT /profile/avatar": "Identity: the profile picture",
	"DELETE /profile/avatar": "Identity: the profile picture",
	"GET /profile/background": "Display: the profile page background",
	"PUT /profile/background": "Display: the profile page background",
	"POST /me/consent": "Identity: stores the consent on the user row",
	"GET /me/deletion":
		"Identity: counts of shared projects and people the delete changes, no ledger",
	"POST /me/deletion": "Identity: leaving must stay possible",

	// Sessions, security and tokens.
	"POST /me/password": "Security: password",
	"GET /me/sessions": "Security: the account's own sessions",
	"DELETE /me/sessions/{id}":
		"Security: ends one of the account's own sessions",
	"POST /me/protection/enable":
		"Security: creates the account's own protection keys and sign-in secret",
	"GET /me/protection/keys":
		"Security: the account's own key parameters, no wraps",
	"POST /me/protection/keys/open":
		"Security: releases the account's own password-opened key wraps to a caller that proved the sign-in secret, never the recovery wrap",
	"POST /me/protection/password/begin":
		"Security: releases the account's own password wrap to a caller that proved the sign-in secret",
	"POST /me/protection/password":
		"Security: changes the account's own password and rewraps its own key, touching no data",
	"GET /vault/changes":
		"Vault: the account's own sealed records, which only its keys open",
	"POST /vault/writes":
		"Vault: stores the account's own sealed records, which only its keys open",
	"GET /events":
		"Feed: the account's own events, filtered to types with no personal ids or amounts",
	"GET /tokens": "Security: the account's own access tokens",
	"POST /tokens": "Security: mints an access token",
	"DELETE /tokens/{id}": "Security: revokes an access token",

	// Devices, push registrations and notification preferences.
	"GET /push-devices": "Devices: the account's own push registrations",
	"POST /push-devices": "Devices: registers a phone for push",
	"DELETE /push-devices/{id}": "Devices: removes a push registration",
	"GET /notifications/preferences": "Settings: which notices go where",
	"PUT /notifications/preferences": "Settings: which notices go where",

	// Public rates and currency lists.
	"GET /currencies": "Public rates: the currency list",
	"GET /rates": "Public rates: shared exchange rates",
	"GET /rates/daily": "Public rates: the shared daily rates",
	"GET /rates/history": "Public rates: the shared rate history",
	"GET /rates/{currency}/history": "Public rates: one currency's history",
	"GET /rates/{currency}/best": "Public rates: the best stored rate",
	"GET /rates/sync-status": "Public rates: when the rates last synced",

	// Admin routes.
	...entries(
		[
			"POST /rates/sync",
			"GET /admin/ai-usage",
			"POST /admin/invite-codes",
			"DELETE /admin/error-reports/{id}",
			"DELETE /admin/feedback/{id}",
			"DELETE /admin/guest-sessions/{id}",
			"DELETE /admin/invite-codes/{id}",
			"DELETE /admin/shadow-profiles/{id}",
			"DELETE /admin/users/{id}",
			"POST /admin/users/{id}/disable",
			"POST /admin/users/{id}/enable",
			"GET /admin/event-logs",
			"GET /admin/ai-settings",
			"GET /admin/backups",
			"GET /admin/feedback/{id}/screenshot",
			"GET /admin/settings",
			"GET /admin/error-reports",
			"GET /admin/feedback",
			"GET /admin/invite-codes",
			"GET /admin/participants",
			"GET /admin/users",
			"DELETE /admin/users/{id}/avatar",
			"POST /admin/test-email",
			"PUT /admin/users/{id}/ai-access",
			"PUT /admin/users/{id}/email-verified",
			"PUT /admin/feedback/{id}/note",
			"PUT /admin/feedback/{id}/status",
			"POST /admin/backups",
			"GET /admin/stats",
			"PATCH /admin/ai-settings",
			"PATCH /admin/settings",
		],
		ADMIN,
	),
};
