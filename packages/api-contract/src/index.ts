import { accountsContract } from "./accounts";
import { adminContract } from "./admin";
import { budgetContract } from "./budget";
import { categoriesContract } from "./categories";
import { currenciesContract } from "./currencies";
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

export * from "./accounts";
export * from "./admin";
export * from "./budget";
export * from "./categories";
export * from "./common";
export * from "./core";
export * from "./currencies";
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
	accounts: accountsContract,
	admin: adminContract,
	budget: budgetContract,
	categories: categoriesContract,
	currencies: currenciesContract,
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
