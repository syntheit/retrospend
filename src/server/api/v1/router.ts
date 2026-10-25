import { categoriesRouter } from "./categories";
import { currenciesRouter } from "./currencies";
import { expensesRouter } from "./expenses";
import { figuresRouter } from "./figures";
import { incomeRouter } from "./income";
import { v1 } from "./middleware";
import { needsYouRouter } from "./needs-you";
import { notificationsRouter } from "./notifications";
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

/**
 * The implemented /api/v1 router. Each resource group registers here with
 * one line, matching the contract index in packages/api-contract.
 */
export const v1Router = v1.router({
	categories: categoriesRouter,
	currencies: currenciesRouter,
	expenses: expensesRouter,
	figures: figuresRouter,
	income: incomeRouter,
	"needs-you": needsYouRouter,
	notifications: notificationsRouter,
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
});
