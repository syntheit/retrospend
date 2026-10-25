import { budgetEditOps as edit } from "~/server/services/api-v1/budget/edits";
import { budgetReadOps as read } from "~/server/services/api-v1/budget/reads";
import { v1 } from "../middleware";
import { budgetHandler as h } from "./handler";
import { budgetMoneyRouter } from "./money";

const b = v1.budget;

export const budgetRouter = {
	setupPreset: b.setupPreset.handler(h(read.setupPreset)),
	month: b.month.handler(h(read.month)),
	verdict: b.verdict.handler(h(read.verdict)),
	leftToSpend: b.leftToSpend.handler(h(read.leftToSpend)),
	fillFromTargets: b.fillFromTargets.handler(h(read.fillFromTargets)),
	coverSources: b.coverSources.handler(h(read.coverSources)),
	history: b.history.handler(h(read.history)),
	owed: b.owed.handler(h(read.owed)),
	monthSummary: b.monthSummary.handler(h(read.monthSummary)),
	welcomeBackState: b.welcomeBackState.handler(h(read.welcomeBack)),
	bankCheck: b.bankCheck.handler(h(read.bankCheck)),
	afford: b.afford.handler(h(read.afford)),
	unroutedShares: b.unroutedShares.handler(h(read.unroutedShares)),
	rules: b.rules.handler(h(read.rules)),
	drafts: b.drafts.handler(h(read.drafts)),
	draftOutcome: b.draftOutcome.handler(h(read.draftOutcome)),
	planFill: b.planFill.handler(h(read.planFill)),
	planCost: b.planCost.handler(h(read.planCost)),
	year: b.year.handler(h(read.year)),
	payoffPlan: b.payoffPlan.handler(h(read.payoffPlan)),
	payoffProjection: b.payoffProjection.handler(h(read.payoffProjection)),
	interestEstimate: b.interestEstimate.handler(h(read.interestEstimate)),
	migration: b.migration.handler(h(read.migration)),
	hiddenRows: b.hiddenRows.handler(h(read.hiddenRows)),
	export: b.export.handler(h(read.export)),
	pacing: b.pacing.handler(h(read.pacing)),

	acknowledgeMonth: b.acknowledgeMonth.handler(h(edit.acknowledgeMonth)),
	pause: b.pause.handler(h(edit.pause)),
	resume: b.resume.handler(h(edit.resume)),
	createRule: b.createRule.handler(h(edit.createRule)),
	updateRule: b.updateRule.handler(h(edit.updateRule)),
	reorderRules: b.reorderRules.handler(h(edit.reorderRules)),
	archiveRule: b.archiveRule.handler(h(edit.archiveRule)),
	saveDraft: b.saveDraft.handler(h(edit.saveDraft)),
	discardDraft: b.discardDraft.handler(h(edit.discardDraft)),
	setGroupTarget: b.setGroupTarget.handler(h(edit.setGroupTarget)),
	setDebtTerms: b.setDebtTerms.handler(h(edit.setDebtTerms)),
	savePayoffPlan: b.savePayoffPlan.handler(h(edit.savePayoffPlan)),
	revertPayoffPlan: b.revertPayoffPlan.handler(h(edit.revertPayoffPlan)),
	dismissMigrationNotice: b.dismissMigrationNotice.handler(
		h(edit.dismissMigrationNotice),
	),

	...budgetMoneyRouter,
};
