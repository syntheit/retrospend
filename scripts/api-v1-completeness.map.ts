/**
 * The completeness map (IMPLEMENTATION S3, milestone 6): every tRPC
 * procedure, keyed by its path, with either the v1 routes that do its job or
 * a written reason it has none. api-v1-completeness.test.ts fails on a
 * procedure missing from here, on a key that names no procedure and on a
 * route that is not in the contract. This is the only list of reasons.
 *
 * Reason kinds:
 * - internal: stays on tRPC or better-auth for good (auth email flows, guest
 *   sessions, claim and unsubscribe tokens).
 * - web-only: a web screen's own helper or diagnostic that no other client
 *   needs.
 * - superseded: the web has moved to a different procedure; the v1 route that
 *   replaces it is named in the reason.
 * - g5-platform: built by the platform agent (tokens, devices, webhooks, the
 *   events feed); lands with that branch.
 * - gap: a real product feature with no v1 route yet. Listed on purpose, so
 *   the gap is a decision and not a surprise.
 */

export type ReasonKind =
	| "internal"
	| "web-only"
	| "superseded"
	| "g5-platform"
	| "gap";

export type Entry =
	| { readonly routes: readonly string[] }
	| { readonly kind: ReasonKind; readonly why: string };

const to = (...routes: string[]): Entry => ({ routes });
const because = (kind: ReasonKind, why: string): Entry => ({ kind, why });
const internal = (why: string) => because("internal", why);
const webOnly = (why: string) => because("web-only", why);
const superseded = (why: string) => because("superseded", why);
const gap = (why: string) => because("gap", why);

/** `POST /x` and its preview twin `POST /x/preview`. */
const withPreview = (route: string): Entry => to(route, `${route}/preview`);

const GUEST = "guest sessions and public project pages stay on tRPC";
const AUTH_MAIL =
	"an auth email flow, handled by better-auth and the web pages";
const CLAIM_TOKEN = "a claim token flow, opened from a link";
const LEGACY_BUDGET =
	"the per-category budget is replaced by the envelope budget (/budget/*)";
const G3_PROJECTS = "G3 people and projects: no v1 route yet";
const G3_CORRECTIONS =
	"G3 corrections (ask to fix, correct, forgive): no v1 route yet";

/** The envelope budget: one entry per procedure, plus its Preview twin. */
function envelope(): Record<string, Entry> {
	const pairs: Record<string, string> = {
		applyDraft: "POST /budget/drafts/{draftId}/apply",
		applyRuleToMonth: "POST /budget/rules/{ruleId}/apply",
		archiveEnvelope: "POST /budget/envelopes/{envelopeId}/archive",
		assign: "POST /budget/assign",
		carryOverspend: "POST /budget/carry-overspend",
		confirmStartingMoney: "POST /budget/starting-money",
		cover: "POST /budget/cover",
		createEnvelope: "POST /budget/envelopes",
		fixNegative: "POST /budget/fix-negative",
		forgive: "POST /budget/forgive",
		fundPlanNow: "POST /budget/drafts/{draftId}/fund-now",
		mergeEnvelopes: "POST /budget/merge-envelopes",
		move: "POST /budget/move",
		reconcile: "POST /budget/reconcile",
		recordDebtPayment: "POST /budget/debt-payments",
		reset: "POST /budget/reset",
		resolveHidden: "POST /budget/hidden-rows/resolve",
		revertHidden: "POST /budget/hidden-rows/revert",
		revertLimit: "POST /budget/limits/revert",
		revertStyle: "POST /budget/style/revert",
		setBookPeriod: "POST /budget/period",
		setLimit: "POST /budget/limits",
		setProjectRouting: "POST /budget/project-routing",
		setShareCategory: "POST /budget/share-category",
		setStyle: "POST /budget/style",
		setTarget: "POST /budget/envelopes/{envelopeId}/target",
		setup: "POST /budget/setup",
		unapplyDraft: "POST /budget/drafts/{draftId}/unapply",
		undo: "POST /budget/undo",
		undoChange: "POST /budget/changes/{id}/undo",
		unforgive: "POST /budget/unforgive",
		usePlan: "POST /budget/use-plan",
		welcomeBack: "POST /budget/welcome-back",
	};
	const out: Record<string, Entry> = {};
	for (const [name, route] of Object.entries(pairs)) {
		out[`envelope.${name}`] = to(route);
		out[`envelope.${name}Preview`] = to(`${route}/preview`);
	}
	const plain: Record<string, Entry> = {
		acknowledgeMonth: to("POST /budget/months/acknowledge"),
		afford: to("GET /budget/afford"),
		archiveRule: to("DELETE /budget/rules/{id}"),
		bankCheck: to("GET /budget/bank-check"),
		coverSources: to("GET /budget/cover-sources"),
		createRule: to("POST /budget/rules"),
		discardDraft: to("POST /budget/drafts/{draftId}/discard"),
		dismissMigrationNotice: to("POST /budget/migration/dismiss"),
		drafts: to("GET /budget/drafts"),
		enabled: to("GET /server-info"),
		exportBudget: to("GET /budget/export"),
		fillFromTargets: to("GET /budget/fill-from-targets"),
		getMonth: to("GET /budget/month"),
		hiddenRows: to("GET /budget/hidden-rows"),
		history: to("GET /budget/history"),
		interestEstimate: to("GET /budget/debts/{liabilityId}/interest-estimate"),
		leftToSpend: to("GET /budget/left-to-spend"),
		migrationState: to("GET /budget/migration"),
		monthSummary: to("GET /budget/month-summary"),
		owed: to("GET /budget/owed"),
		pacing: to("GET /budget/pacing"),
		pause: to("POST /budget/pause"),
		payoffPlan: to("GET /budget/payoff-plan"),
		payoffProject: to("GET /budget/payoff-projection"),
		planCost: to("GET /budget/plan-cost"),
		planFill: to("GET /budget/plan-fill"),
		previewDraft: to("GET /budget/drafts/{draftId}/outcome"),
		removeAdjustment: to("DELETE /budget/adjustments/{expenseId}"),
		removeAdjustmentPreview: to("POST /budget/adjustments/{expenseId}/preview"),
		reorderRules: to("POST /budget/rules/reorder"),
		resume: to("POST /budget/resume"),
		revertPayoffPlan: withPreview("POST /budget/payoff-plan/revert"),
		rules: to("GET /budget/rules"),
		saveDraft: to("POST /budget/drafts"),
		savePayoffPlan: to(
			"PUT /budget/payoff-plan",
			"POST /budget/payoff-plan/preview",
		),
		setDebtTerms: to(
			"PUT /budget/debts/{assetAccountId}/terms",
			"POST /budget/debts/{assetAccountId}/terms/preview",
		),
		setGroupTarget: to(
			"PUT /budget/groups/{groupId}/target",
			"POST /budget/groups/{groupId}/target/preview",
		),
		setupPreset: to("GET /budget/setup-preset"),
		unroutedShares: to("GET /budget/unrouted-shares"),
		updateEnvelope: to("PATCH /budget/envelopes/{envelopeId}"),
		updateEnvelopePreview: to("POST /budget/envelopes/{envelopeId}/preview"),
		updateRule: to("PATCH /budget/rules/{id}"),
		verdict: to("GET /budget/verdict"),
		welcomeBackState: to("GET /budget/welcome-back"),
		yearView: to("GET /budget/year"),
	};
	for (const [name, entry] of Object.entries(plain))
		out[`envelope.${name}`] = entry;
	return out;
}

export const COMPLETENESS: Readonly<Record<string, Entry>> = {
	// ── admin ────────────────────────────────────────────────────────────
	"admin.deleteGuestSession": webOnly(
		"cleanup of guest sessions, which list names other users typed; guests stay on tRPC",
	),
	"admin.deleteShadowProfile": webOnly(
		"cleanup of shadow profiles, which list names other users typed",
	),
	"admin.deleteUser": to("DELETE /admin/users/{id}"),
	"admin.disableUser": to("POST /admin/users/{id}/disable"),
	"admin.enableUser": to("POST /admin/users/{id}/enable"),
	"admin.generatePasswordResetLink": webOnly(
		"hands a reset secret to an admin; credentials are not issued over API tokens",
	),
	"admin.getAiSettings": to("GET /admin/ai-settings"),
	"admin.getAiUsageStats": to("GET /admin/ai-usage"),
	"admin.getAuditLogPrivacyMode": to("GET /admin/settings"),
	"admin.getBackupStatus": to("GET /admin/backups"),
	"admin.getEventLogs": to("GET /admin/event-logs"),
	"admin.getEventLogsCursor": to("GET /admin/event-logs"),
	"admin.getServerStats": to("GET /admin/stats"),
	"admin.getSettings": to("GET /admin/settings"),
	"admin.getStats": to("GET /admin/stats"),
	"admin.listGuestSessions": webOnly(
		"lists guest sessions with names other users typed; guests stay on tRPC",
	),
	"admin.listShadowProfiles": webOnly(
		"lists shadow profiles with names other users typed",
	),
	"admin.listUsers": to("GET /admin/users"),
	"admin.markEmailVerified": to("PUT /admin/users/{id}/email-verified"),
	"admin.removeUserAvatar": to("DELETE /admin/users/{id}/avatar"),
	"admin.resetPassword": webOnly(
		"returns a new password to an admin; credentials are not issued over API tokens",
	),
	"admin.sendTestEmail": webOnly("an SMTP check button in the admin screen"),
	"admin.setUserAiAccess": to("PUT /admin/users/{id}/ai-access"),
	"admin.toggleEmailVerification": to("PUT /admin/users/{id}/email-verified"),
	"admin.triggerBackup": to("POST /admin/backups"),
	"admin.updateAiSettings": to("PATCH /admin/ai-settings"),
	"admin.updateSettings": to("PATCH /admin/settings"),

	// ── auditLog (shared expense history and project activity) ───────────
	"auditLog.markTransactionSeen": gap(
		"G3: seen marks on shared expense changes have no v1 route",
	),
	"auditLog.projectActivityFeed": gap("G3: the project activity feed"),
	"auditLog.projectActivityFilters": gap("G3: the project activity feed"),
	"auditLog.projectsLastActivity": gap("G3: the project activity feed"),
	"auditLog.transactionHistory": gap("G2/G3: revision history of an expense"),
	"auditLog.transactionRevisionSummary": gap(
		"G2/G3: revision history of an expense",
	),

	// ── auth ─────────────────────────────────────────────────────────────
	"auth.confirmEmailChange": internal(AUTH_MAIL),
	"auth.getAppFeatures": to("GET /server-info"),
	"auth.recordConsent": gap(
		"consent after sign-up, needed by a mobile sign-up when legal pages are on",
	),
	"auth.requestPasswordReset": internal(AUTH_MAIL),
	"auth.resendVerificationEmail": internal(AUTH_MAIL),
	"auth.resetPassword": internal(AUTH_MAIL),
	"auth.revertEmailChange": internal(AUTH_MAIL),
	"auth.verifyEmail": internal(AUTH_MAIL),

	// ── billing periods ──────────────────────────────────────────────────
	"billingPeriod.closeCurrent": gap(G3_PROJECTS),
	"billingPeriod.detail": gap(G3_PROJECTS),
	"billingPeriod.list": gap(G3_PROJECTS),
	"billingPeriod.settlePeriod": gap(G3_PROJECTS),
	"billingPeriod.updateLabel": gap(G3_PROJECTS),

	// ── legacy per-category budget ───────────────────────────────────────
	"budget.batchUpsertBudgets": superseded(LEGACY_BUDGET),
	"budget.copyFromLastMonth": superseded(LEGACY_BUDGET),
	"budget.deleteBudget": superseded(LEGACY_BUDGET),
	"budget.deleteGlobalBudget": superseded(LEGACY_BUDGET),
	"budget.exportCsv": superseded(LEGACY_BUDGET),
	"budget.getBudgetSuggestions": superseded(LEGACY_BUDGET),
	"budget.getBudgets": superseded(LEGACY_BUDGET),
	"budget.getEarliestBudgetMonth": superseded(LEGACY_BUDGET),
	"budget.hasBudgetsBeforeMonth": superseded(LEGACY_BUDGET),
	"budget.importBudgets": superseded(LEGACY_BUDGET),
	"budget.upsertBudget": superseded(LEGACY_BUDGET),
	"budget.upsertGlobalBudget": superseded(LEGACY_BUDGET),

	// ── categories ───────────────────────────────────────────────────────
	"categories.create": to("POST /categories"),
	"categories.delete": to("DELETE /categories/{id}"),
	"categories.getAll": to("GET /categories"),
	"categories.update": to("PATCH /categories/{id}"),

	// ── claim ────────────────────────────────────────────────────────────
	"claim.claimByToken": internal(CLAIM_TOKEN),
	"claim.generateLink": to("POST /people/shadow/{id}/claim-link"),
	"claim.info": internal(CLAIM_TOKEN),
	"claim.linkGuestToGhost": internal(GUEST),
	"claim.projectGhosts": internal(GUEST),

	// ── corrections ──────────────────────────────────────────────────────
	"corrections.askToFix.preview": gap(G3_CORRECTIONS),
	"corrections.askToFix.save": gap(G3_CORRECTIONS),
	"corrections.cancelFix.preview": gap(G3_CORRECTIONS),
	"corrections.cancelFix.save": gap(G3_CORRECTIONS),
	"corrections.correct.preview": gap(G3_CORRECTIONS),
	"corrections.correct.save": gap(G3_CORRECTIONS),
	"corrections.fixRequests": gap(G3_CORRECTIONS),
	"corrections.forgive.preview": gap(G3_CORRECTIONS),
	"corrections.forgive.save": gap(G3_CORRECTIONS),
	"corrections.lockStates": gap(G3_CORRECTIONS),
	"corrections.respondToFix.preview": gap(G3_CORRECTIONS),
	"corrections.respondToFix.save": gap(G3_CORRECTIONS),
	"corrections.restoreFix.preview": gap(G3_CORRECTIONS),
	"corrections.restoreFix.save": gap(G3_CORRECTIONS),
	"corrections.undoCorrection.preview": gap(G3_CORRECTIONS),
	"corrections.undoCorrection.save": gap(G3_CORRECTIONS),
	"corrections.unforgive.preview": gap(G3_CORRECTIONS),
	"corrections.unforgive.save": gap(G3_CORRECTIONS),
	"corrections.withdrawFix.preview": gap(G3_CORRECTIONS),
	"corrections.withdrawFix.save": gap(G3_CORRECTIONS),

	// ── old home dashboard ───────────────────────────────────────────────
	"dashboard.getOverviewData": superseded(
		"replaced by GET /figures/glance and GET /needs-you",
	),
	"dashboard.getOverviewStats": superseded("replaced by GET /figures"),
	"dashboard.getRecentActivity": superseded("replaced by GET /expenses"),

	// ── approved devices (platform) ──────────────────────────────────────
	"deviceSession.disconnect": because(
		"g5-platform",
		"approved devices are listed and disconnected with the platform tokens",
	),
	"deviceSession.list": because(
		"g5-platform",
		"approved devices are listed and disconnected with the platform tokens",
	),

	// ── add sheets ───────────────────────────────────────────────────────
	"entry.catalog": gap(
		"the Add sheets read categories, recents and places in one call",
	),
	"entry.defaultRateTypes": gap("default rate type per home currency"),
	"entry.expense.create.preview": to("POST /expenses/preview"),
	"entry.expense.create.save": to("POST /expenses"),
	"entry.expense.delete.preview": to("POST /expenses/{id}/delete/preview"),
	"entry.expense.delete.save": to("DELETE /expenses/{id}"),
	"entry.expense.get": to("GET /expenses/{id}"),
	"entry.expense.restore.preview": to("POST /expenses/undo/preview"),
	"entry.expense.restore.save": to("POST /expenses/undo"),
	"entry.expense.revert.preview": to("POST /expenses/undo/preview"),
	"entry.expense.revert.save": to("POST /expenses/undo"),
	"entry.expense.update.preview": to("POST /expenses/{id}/preview"),
	"entry.expense.update.save": to("PUT /expenses/{id}"),
	"entry.projectMembers": to("GET /projects/{id}/members"),
	"entry.rateOptions": gap("the rate strip: every rate type a pair offers"),
	"entry.setDefaultRateType": gap("default rate type per home currency"),
	"entry.shared.create.preview": to("POST /shared-expenses/preview"),
	"entry.shared.create.save": to("POST /shared-expenses"),
	"entry.shared.delete.preview": to(
		"POST /shared-expenses/{id}/delete/preview",
	),
	"entry.shared.delete.save": to("DELETE /shared-expenses/{id}"),
	"entry.shared.revert.preview": to("POST /shared-expenses/undo/preview"),
	"entry.shared.revert.save": to("POST /shared-expenses/undo"),
	"entry.shared.update.preview": to("POST /shared-expenses/{id}/preview"),
	"entry.shared.update.save": to("PUT /shared-expenses/{id}"),
	"entry.sharedAuthor": gap("who added a shared expense"),
	"entry.transfer.preview": to("POST /transfers/preview"),
	"entry.transfer.save": to("POST /transfers"),

	// ── envelope budget ──────────────────────────────────────────────────
	...envelope(),

	// ── exchange rates ───────────────────────────────────────────────────
	"exchangeRate.getAllRates": to("GET /rates"),
	"exchangeRate.getLastSync": to("GET /rates/sync-status"),
	"exchangeRate.getRate": to("GET /rates/{currency}/best"),
	"exchangeRate.getRatesForCurrency": to("GET /rates/{currency}/history"),
	"exchangeRate.syncNow": to("POST /rates/sync"),

	// ── expenses ─────────────────────────────────────────────────────────
	"expense.bulkUpdateCategory": withPreview("POST /expenses/bulk-category"),
	"expense.checkDuplicate": to("GET /expenses/duplicates"),
	"expense.createExpense": to("POST /expenses"),
	"expense.deleteExpense": to("DELETE /expenses/{id}"),
	"expense.exportCsv": to("POST /exports/jobs"),
	"expense.getExpense": to("GET /expenses/{id}"),
	"expense.getExpensesByDate": to("GET /expenses"),
	"expense.getFilterOptions": superseded(
		"the filter bar builds its options from /categories, /currencies and /people",
	),
	"expense.importExpenses": superseded(
		"replaced by POST /imports/jobs and its finalize route",
	),
	"expense.listFinalized": to("GET /expenses"),
	"expense.listSharedParticipations": superseded(
		"shared entries are part of GET /expenses",
	),
	"expense.listV2": to("GET /expenses"),
	"expense.titleSuggestions": to("GET /expenses/title-suggestions"),
	"expense.updateExpense": to("PUT /expenses/{id}"),

	// ── exports ──────────────────────────────────────────────────────────
	"exportData.allData": to("POST /exports/jobs"),
	"exportData.exportBillingPeriodSummary": to("POST /exports/jobs"),
	"exportData.exportPersonHistory": to("POST /exports/jobs"),
	"exportData.exportPersonPdf": to("POST /exports/jobs"),
	"exportData.exportPersonSettlementPlan": to("POST /exports/jobs"),
	"exportData.exportProjectExpenses": to("POST /exports/jobs"),
	"exportData.exportProjectPdf": to("POST /exports/jobs"),
	"exportData.exportSettlementPlan": to("POST /exports/jobs"),

	// ── feedback ─────────────────────────────────────────────────────────
	"feedback.addNote": to("PUT /admin/feedback/{id}/note"),
	"feedback.delete": to("DELETE /admin/feedback/{id}"),
	"feedback.list": to("GET /admin/feedback"),
	"feedback.submit": to("POST /feedback"),
	"feedback.unreadCount": to("GET /admin/feedback"),
	"feedback.updateStatus": to("PUT /admin/feedback/{id}/status"),

	// ── guests ───────────────────────────────────────────────────────────
	"guest.deleteMyData": internal(GUEST),
	"guest.joinWithAccount": internal(GUEST),
	"guest.register": internal(GUEST),
	"guest.resume": internal(GUEST),
	"guest.validateLink": internal(GUEST),

	// ── home ─────────────────────────────────────────────────────────────
	"home.glance": to("GET /figures/glance"),
	"home.needsYou": to("GET /needs-you"),
	"home.snoozeNeedsYou": gap("Later on a Needs you item"),
	"home.unsnoozeNeedsYou": gap("Later on a Needs you item"),

	// ── imports ──────────────────────────────────────────────────────────
	"importQueue.cancelJob": to("POST /imports/jobs/{id}/cancel"),
	"importQueue.commit": to("POST /imports/jobs/{id}/finalize"),
	"importQueue.commitPreview": to("POST /imports/jobs/{id}/finalize/preview"),
	"importQueue.createJob": to("POST /imports/jobs"),
	"importQueue.deleteJob": to("DELETE /imports/jobs/{id}"),
	"importQueue.finalizeImport": superseded(
		"the old finalize took rows from the client; POST /imports/jobs/{id}/finalize decides per stored row",
	),
	"importQueue.getGlobalStats": to("GET /admin/stats"),
	"importQueue.getJob": to("GET /imports/jobs/{id}"),
	"importQueue.getQueueStatus": to("GET /imports/jobs"),
	"importQueue.listJobs": to("GET /imports/jobs"),
	"importQueue.recent": to("GET /imports/jobs"),
	"importQueue.review": to("GET /imports/jobs/{id}/review"),
	"importQueue.startReview": superseded(
		"review is a read (GET /imports/jobs/{id}/review) and finalize accepts a ready file",
	),
	"importQueue.undo": to("POST /imports/jobs/{id}/undo"),

	// ── insights ─────────────────────────────────────────────────────────
	"insights.cashflow": to("GET /figures"),
	"insights.firstDay": gap("the day where All time starts"),
	"insights.months": to("GET /figures"),
	"insights.summary": to("GET /figures"),
	"insights.ytd": to("GET /figures"),

	// ── invite codes ─────────────────────────────────────────────────────
	"invite.delete": to("DELETE /admin/invite-codes/{id}"),
	"invite.deleteUserCode": to("DELETE /invite-codes/{id}"),
	"invite.generate": to("POST /admin/invite-codes"),
	"invite.generateUserCode": to("POST /invite-codes"),
	"invite.list": to("GET /admin/invite-codes"),
	"invite.listUserCodes": to("GET /invite-codes"),
	"invite.validate": internal(
		"the public sign-up check, slowed on purpose against guessing",
	),

	// ── notifications ────────────────────────────────────────────────────
	"notification.getPreferences": to("GET /notifications/preferences"),
	"notification.list": to("GET /notifications"),
	"notification.markAllRead": to("POST /notifications/read-all"),
	"notification.markRead": to("POST /notifications/{id}/read"),
	"notification.unreadCount": to("GET /notifications/unread-count"),
	"notification.unsubscribe": internal("an unsubscribe link from an email"),
	"notification.unsubscribeAll": internal("an unsubscribe link from an email"),
	"notification.updatePreferences": to("PUT /notifications/preferences"),

	// ── payment methods ──────────────────────────────────────────────────
	"paymentMethod.getForUser": gap("G3: payment methods shown on a person"),
	"paymentMethod.list": gap("G3: payment methods"),
	"paymentMethod.match": gap("G3: payment methods"),
	"paymentMethod.upsert": gap("G3: payment methods"),

	// ── people ───────────────────────────────────────────────────────────
	"people.balance": to("GET /people/{type}/{id}"),
	"people.claimedShadowCount": webOnly("a welcome banner on the web dashboard"),
	"people.createShadow": to("POST /people"),
	"people.detail": to("GET /people/{type}/{id}"),
	"people.detailCursor": to("GET /people/{type}/{id}/ledger"),
	"people.frequentSplitPartners": gap("the people a split suggests first"),
	"people.list": to("GET /people"),
	"people.overview": to("GET /people"),
	"people.page": to("GET /people/{type}/{id}"),
	"people.search": to("GET /search"),
	"people.settleContext": to("GET /people/{type}/{id}/settle"),
	"people.undoPayment": to("POST /payments/undo"),
	"people.updateShadow": to("PATCH /people/shadow/{id}"),

	// ── view settings ────────────────────────────────────────────────────
	"preferences.deleteAnalyticsCategoryPreference": to(
		"DELETE /settings/category-preferences/{categoryId}",
	),
	"preferences.getAnalyticsCategoryPreferenceMap": to(
		"GET /settings/category-preferences",
	),
	"preferences.getAnalyticsCategoryPreferences": to(
		"GET /settings/category-preferences",
	),
	"preferences.getFavoriteCurrencies": to("GET /settings/favorite-rates"),
	"preferences.getFavoriteExchangeRateIds": to("GET /settings/favorite-rates"),
	"preferences.getFavoriteExchangeRates": to("GET /settings/favorite-rates"),
	"preferences.getPageSettings": to("GET /settings/pages/{page}"),
	"preferences.reorderFavorites": to("PUT /settings/favorite-rates/order"),
	"preferences.toggleFavoriteExchangeRate": to(
		"POST /settings/favorite-rates",
		"DELETE /settings/favorite-rates/{exchangeRateId}",
	),
	"preferences.updateAnalyticsCategoryPreference": to(
		"PUT /settings/category-preferences/{categoryId}",
	),
	"preferences.updatePageSettings": to("PATCH /settings/pages/{page}"),

	// ── profile ──────────────────────────────────────────────────────────
	"profile.cancelPendingEmailChange": to("DELETE /profile/pending-email"),
	"profile.changePassword": internal(
		"passwords are changed through the better-auth endpoints",
	),
	"profile.getBackgroundSettings": to("GET /profile/background"),
	"profile.getLifetimeStats": gap("lifetime totals on the profile page"),
	"profile.getMyAvatar": to("GET /profile"),
	"profile.getPendingEmail": to("GET /profile"),
	"profile.publicProfile": webOnly("the public profile web page"),
	"profile.saveBackgroundSettings": to("PUT /profile/background"),
	"profile.update": to("PATCH /profile"),

	// ── projects ─────────────────────────────────────────────────────────
	"project.addParticipant": gap(G3_PROJECTS),
	"project.balancesFromPerspective": gap(G3_PROJECTS),
	"project.create": gap(G3_PROJECTS),
	"project.createMagicLink": gap(G3_PROJECTS),
	"project.delete": gap(G3_PROJECTS),
	"project.detail": to("GET /projects/{id}"),
	"project.list": to("GET /projects"),
	"project.listExpenses": gap(G3_PROJECTS),
	"project.listMagicLinks": gap(G3_PROJECTS),
	"project.listView": to("GET /projects"),
	"project.membersOn": to("GET /projects/{id}/members"),
	"project.membershipDatesPreview": gap(G3_PROJECTS),
	"project.pageView": to("GET /projects/{id}"),
	"project.participantBalances": to("GET /projects/{id}/summary"),
	"project.publicDetail": internal(GUEST),
	"project.publicListExpenses": internal(GUEST),
	"project.rebalanceExpenses": gap(G3_PROJECTS),
	"project.rebalanceableExpenses": gap(G3_PROJECTS),
	"project.removeParticipant": gap(G3_PROJECTS),
	"project.resetMagicLink": gap(G3_PROJECTS),
	"project.revokeMagicLink": gap(G3_PROJECTS),
	"project.setMembershipDates": gap(G3_PROJECTS),
	"project.settleAll": to("POST /projects/{id}/settle-all"),
	"project.settleAllPreview": to("POST /projects/{id}/settle-all/preview"),
	"project.settleAllUndo": to("POST /projects/{id}/settle-all/undo"),
	"project.settlementPlan": to("GET /projects/{id}/settle-all/plan"),
	"project.summary": to("GET /projects/{id}/summary"),
	"project.transferOwnership": gap(G3_PROJECTS),
	"project.update": gap(G3_PROJECTS),
	"project.updateAnalyticsExclusion": gap(G3_PROJECTS),
	"project.updateParticipantRole": gap(G3_PROJECTS),

	// ── recurring ────────────────────────────────────────────────────────
	"recurring.confirmAndCreate": withPreview("POST /recurring/{id}/confirm"),
	"recurring.create": to("POST /recurring"),
	"recurring.delete": to("DELETE /recurring/{id}"),
	"recurring.get": to("GET /recurring/{id}"),
	"recurring.getPendingConfirmation": to("GET /needs-you"),
	"recurring.list": to("GET /recurring"),
	"recurring.listView": to("GET /recurring", "GET /recurring/summary"),
	"recurring.update": to("PATCH /recurring/{id}"),

	// ── settings ─────────────────────────────────────────────────────────
	"settings.getAiStatus": gap("whether AI features are available to this user"),
	"settings.getGeneral": to("GET /settings"),
	"settings.getInviteOnlyEnabled": to("GET /server-info"),
	"settings.updateGeneral": to("PATCH /settings"),

	// ── settle up ────────────────────────────────────────────────────────
	"settlement.confirm": to("POST /payments/{id}/confirm"),
	"settlement.create": superseded("replaced by POST /payments"),
	"settlement.deletePending": gap("G3: withdraw a pending payment"),
	"settlement.history": gap("G3: payment history with a person"),
	"settlement.paymentConfirm": to("POST /payments/{id}/confirm"),
	"settlement.paymentConfirmPreview": to("POST /payments/{id}/confirm/preview"),
	"settlement.paymentPreview": to("POST /payments/preview"),
	"settlement.paymentRecord": to("POST /payments"),
	"settlement.paymentUnconfirm": to("POST /payments/undo"),
	"settlement.paymentUnconfirmPreview": to("POST /payments/undo/preview"),
	"settlement.pendingForMe": to("GET /needs-you"),
	"settlement.plan": to("GET /people/{type}/{id}/settle"),
	"settlement.reject": to("POST /payments/{id}/not-received"),
	"settlement.requestPayment": to("POST /people/{type}/{id}/remind"),
	"settlement.sendReminder": to("POST /payments/{id}/remind"),
	"settlement.settleAll": gap("G3: settle everything with one person"),
	"settlement.squareUp": gap("G3: square up across projects"),
	"settlement.squareUpOptions": gap("G3: square up across projects"),
	"settlement.void": gap("G3: void a payment to a person without an account"),

	// ── shared expenses ──────────────────────────────────────────────────
	"sharedTransaction.canModify": gap(
		"G3: whether a split expense can be edited",
	),
	"sharedTransaction.create": to("POST /shared-expenses"),
	"sharedTransaction.delete": to("DELETE /shared-expenses/{id}"),
	"sharedTransaction.getById": gap("G3: read one split expense"),
	"sharedTransaction.update": to("PUT /shared-expenses/{id}"),

	// ── old stats ────────────────────────────────────────────────────────
	"stats.getCategoryBreakdown": superseded(
		"replaced by the insights figures (GET /figures)",
	),
	"stats.getDailyTrend": superseded(
		"replaced by the insights figures (GET /figures)",
	),
	"stats.getLifetimeStats": superseded(
		"replaced by the insights figures (GET /figures)",
	),
	"stats.getSummary": superseded(
		"replaced by the insights figures (GET /figures)",
	),

	// ── system ───────────────────────────────────────────────────────────
	"system.checkImporterStatus": webOnly("a diagnostic banner in the web app"),
	"system.checkSidecarStatus": webOnly("a diagnostic banner in the web app"),
	"system.getFeatureFlags": to("GET /server-info"),
	"system.getServerTime": webOnly("clock check for the web app"),
	"system.getWorkerStatus": webOnly("a diagnostic banner in the web app"),

	// ── account ──────────────────────────────────────────────────────────
	"user.deleteAccount": gap(
		"self-service account deletion, which an iOS app must offer in the app",
	),
	"user.previewAccountDeletion": gap(
		"self-service account deletion, which an iOS app must offer in the app",
	),
	"user.updateProfile": to("PATCH /profile"),

	// ── verification of shared expenses ──────────────────────────────────
	"verification.accept": to("POST /shared-expenses/{id}/accept"),
	"verification.bulkAccept": gap("G3: accept many shares at once"),
	"verification.outgoing": gap("G3: shares others have not answered yet"),
	"verification.queue": to("GET /needs-you"),
	"verification.reject": to("POST /shared-expenses/{id}/reject"),
	"verification.removeSelf": gap("G3: remove yourself from a split expense"),

	// ── wealth ───────────────────────────────────────────────────────────
	"wealth.accounts.defaults": to("GET /accounts/defaults"),
	"wealth.accounts.revertBalanceUpdate.preview": to(
		"POST /accounts/undo/preview",
	),
	"wealth.accounts.revertBalanceUpdate.save": to("POST /accounts/undo"),
	"wealth.accounts.revertRateType.preview": to("POST /accounts/undo/preview"),
	"wealth.accounts.revertRateType.save": to("POST /accounts/undo"),
	"wealth.accounts.setDefault": to("PUT /accounts/defaults/{currency}"),
	"wealth.accounts.setRateType.preview": to(
		"POST /accounts/{id}/rate-type/preview",
	),
	"wealth.accounts.setRateType.save": to("POST /accounts/{id}/rate-type"),
	"wealth.accounts.view": to("GET /accounts/{id}"),
	"wealth.closeAsset": to("POST /accounts/{id}/close"),
	"wealth.createAsset": to("POST /accounts"),
	"wealth.deleteAssetPermanently": to("POST /accounts/{id}/delete"),
	"wealth.exportCsv": to("GET /accounts/export"),
	"wealth.figures": to("GET /accounts/net-worth"),
	"wealth.getDashboard": to("GET /accounts", "GET /accounts/net-worth"),
	"wealth.getRunwayStats": gap("how long the money lasts at the current pace"),
	"wealth.importAssets": gap("import accounts from a CSV file"),
	"wealth.income.add.preview": to("POST /income/preview"),
	"wealth.income.add.save": to("POST /income"),
	"wealth.income.confirmRecurring.preview": to(
		"POST /recurring/{id}/confirm/preview",
	),
	"wealth.income.confirmRecurring.save": to("POST /recurring/{id}/confirm"),
	"wealth.income.delete.preview": to("POST /income/{id}/preview"),
	"wealth.income.delete.save": to("DELETE /income/{id}"),
	"wealth.income.moveIn.preview": gap("move income into an account"),
	"wealth.income.moveIn.save": gap("move income into an account"),
	"wealth.income.recreate.preview": to("POST /income/undo/preview"),
	"wealth.income.recreate.save": to("POST /income/undo"),
	"wealth.income.unconfirmRecurring.preview": to(
		"POST /recurring/undo/preview",
	),
	"wealth.income.unconfirmRecurring.save": to("POST /recurring/undo"),
	"wealth.income.undoMoveIn.preview": gap("move income into an account"),
	"wealth.income.undoMoveIn.save": gap("move income into an account"),
	"wealth.reopenAsset": to("POST /accounts/{id}/reopen"),
	"wealth.transfers.create.preview": to("POST /transfers/preview"),
	"wealth.transfers.create.save": to("POST /transfers"),
	"wealth.transfers.delete.preview": to("POST /transfers/{id}/preview"),
	"wealth.transfers.delete.save": to("DELETE /transfers/{id}"),
	"wealth.transfers.recreate.preview": to("POST /transfers/undo/preview"),
	"wealth.transfers.recreate.save": to("POST /transfers/undo"),
	"wealth.updateAsset": to("PUT /accounts/{id}"),
	"wealth.updateAssetBalance": to("POST /accounts/{id}/balance"),
};
