import { accountRouter } from "./account";
import { accountsRouter } from "./accounts";
import { activityRouter } from "./activity";
import { adminRouter } from "./admin";
import { billingPeriodsRouter } from "./billing-periods";
import { budgetRouter } from "./budget";
import { categoriesRouter } from "./categories";
import { correctionsRouter } from "./corrections";
import { currenciesRouter } from "./currencies";
import { entryRouter } from "./entry";
import { eventsRouter } from "./events";
import { expensesRouter } from "./expenses";
import { exportsRouter } from "./exports";
import { feedbackRouter } from "./feedback";
import { figuresRouter } from "./figures";
import { importsRouter } from "./imports";
import { incomeRouter } from "./income";
import { inviteCodesRouter } from "./invite-codes";
import { v1 } from "./middleware";
import { needsYouRouter } from "./needs-you";
import { notificationsRouter } from "./notifications";
import { paymentMethodsRouter } from "./payment-methods";
import { paymentsRouter } from "./payments";
import { peopleRouter } from "./people";
import { platformRouter } from "./platform";
import { profileRouter } from "./profile";
import { projectsRouter } from "./projects";
import { pushRouter } from "./push";
import { recurringRouter } from "./recurring";
import { searchRouter } from "./search";
import { settingsRouter } from "./settings";
import { sharedExpensesRouter } from "./shared-expenses";
import { tokensRouter } from "./tokens";
import { transfersRouter } from "./transfers";
import { webhooksRouter } from "./webhooks";

/**
 * The implemented /api/v1 router. Each resource group registers here with
 * one line, matching the contract index in packages/api-contract.
 */
export const v1Router = v1.router({
	account: accountRouter,
	accounts: accountsRouter,
	activity: activityRouter,
	admin: adminRouter,
	"billing-periods": billingPeriodsRouter,
	budget: budgetRouter,
	categories: categoriesRouter,
	corrections: correctionsRouter,
	currencies: currenciesRouter,
	entry: entryRouter,
	events: eventsRouter,
	expenses: expensesRouter,
	exports: exportsRouter,
	feedback: feedbackRouter,
	figures: figuresRouter,
	imports: importsRouter,
	income: incomeRouter,
	"invite-codes": inviteCodesRouter,
	"needs-you": needsYouRouter,
	notifications: notificationsRouter,
	"payment-methods": paymentMethodsRouter,
	payments: paymentsRouter,
	people: peopleRouter,
	platform: platformRouter,
	profile: profileRouter,
	projects: projectsRouter,
	push: pushRouter,
	recurring: recurringRouter,
	search: searchRouter,
	settings: settingsRouter,
	"shared-expenses": sharedExpensesRouter,
	tokens: tokensRouter,
	transfers: transfersRouter,
	webhooks: webhooksRouter,
});
