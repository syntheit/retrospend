import { categoriesRouter } from "./categories";
import { currenciesRouter } from "./currencies";
import { figuresRouter } from "./figures";
import { v1 } from "./middleware";
import { notificationsRouter } from "./notifications";
import { platformRouter } from "./platform";
import { profileRouter } from "./profile";
import { pushRouter } from "./push";
import { searchRouter } from "./search";
import { settingsRouter } from "./settings";
import { tokensRouter } from "./tokens";

/**
 * The implemented /api/v1 router. Each resource group registers here with
 * one line, matching the contract index in packages/api-contract.
 */
export const v1Router = v1.router({
	categories: categoriesRouter,
	currencies: currenciesRouter,
	figures: figuresRouter,
	notifications: notificationsRouter,
	platform: platformRouter,
	profile: profileRouter,
	push: pushRouter,
	search: searchRouter,
	settings: settingsRouter,
	tokens: tokensRouter,
});
