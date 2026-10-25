import { accountContract } from "./account";
import { accountsContract } from "./accounts";
import { activityContract } from "./activity";
import { adminContract } from "./admin";
import { billingPeriodsContract } from "./billing-periods";
import { budgetContract } from "./budget";
import { categoriesContract } from "./categories";
import { correctionsContract } from "./corrections";
import { currenciesContract } from "./currencies";
import { entryContract } from "./entry";
import { eventsContract } from "./events";
import { expensesContract } from "./expenses";
import { exportsContract } from "./exports";
import { feedbackContract } from "./feedback";
import { figuresContract } from "./figures";
import { importsContract } from "./imports";
import { incomeContract } from "./income";
import { inviteCodesContract } from "./invite-codes";
import { needsYouContract } from "./needs-you";
import { notificationsContract } from "./notifications";
import { paymentsContract } from "./payments";
import { paymentMethodsContract } from "./payment-methods";
import { peopleContract } from "./people";
import { platformContract } from "./platform";
import { profileContract } from "./profile";
import { projectsContract } from "./projects";
import { pushContract } from "./push";
import { recurringContract } from "./recurring";
import { searchContract } from "./search";
import { settingsContract } from "./settings";
import { sharedExpensesContract } from "./shared-expenses";
import { tokensContract } from "./tokens";
import { transfersContract } from "./transfers";
import { webhooksContract } from "./webhooks";

export * from "./account";
export * from "./accounts";
export * from "./activity";
export * from "./admin";
export * from "./billing-periods";
export * from "./budget";
export * from "./categories";
export * from "./common";
export * from "./core";
export * from "./corrections";
export * from "./currencies";
export * from "./entry";
export * from "./events";
export * from "./expenses";
export * from "./exports";
export * from "./feedback";
export * from "./figures";
export * from "./imports";
export * from "./income";
export * from "./invite-codes";
export * from "./ledger";
export * from "./needs-you";
export * from "./notifications";
export * from "./payment-methods";
export * from "./payments";
export * from "./people";
export * from "./platform";
export * from "./profile";
export * from "./projects";
export * from "./push";
export * from "./recurring";
export * from "./search";
export * from "./settings";
export * from "./shared-expenses";
export * from "./tokens";
export * from "./transfers";
export * from "./webhooks";

/**
 * The whole /api/v1 contract. Each resource group registers here with one
 * line (S3b to S3d own their folders: `src/<group>/*`).
 */
export const contract = {
	account: accountContract,
	accounts: accountsContract,
	activity: activityContract,
	admin: adminContract,
	"billing-periods": billingPeriodsContract,
	budget: budgetContract,
	categories: categoriesContract,
	corrections: correctionsContract,
	currencies: currenciesContract,
	entry: entryContract,
	events: eventsContract,
	expenses: expensesContract,
	exports: exportsContract,
	feedback: feedbackContract,
	figures: figuresContract,
	imports: importsContract,
	income: incomeContract,
	"invite-codes": inviteCodesContract,
	"needs-you": needsYouContract,
	notifications: notificationsContract,
	"payment-methods": paymentMethodsContract,
	payments: paymentsContract,
	people: peopleContract,
	platform: platformContract,
	profile: profileContract,
	recurring: recurringContract,
	projects: projectsContract,
	push: pushContract,
	search: searchContract,
	settings: settingsContract,
	"shared-expenses": sharedExpensesContract,
	tokens: tokensContract,
	transfers: transfersContract,
	webhooks: webhooksContract,
};

export type Contract = typeof contract;
