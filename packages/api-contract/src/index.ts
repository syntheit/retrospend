import { categoriesContract } from "./categories";
import { currenciesContract } from "./currencies";
import { expensesContract } from "./expenses";
import { figuresContract } from "./figures";
import { incomeContract } from "./income";
import { needsYouContract } from "./needs-you";
import { notificationsContract } from "./notifications";
import { platformContract } from "./platform";
import { profileContract } from "./profile";
import { pushContract } from "./push";
import { recurringContract } from "./recurring";
import { searchContract } from "./search";
import { settingsContract } from "./settings";
import { tokensContract } from "./tokens";
import { transfersContract } from "./transfers";

export * from "./categories";
export * from "./common";
export * from "./core";
export * from "./currencies";
export * from "./expenses";
export * from "./figures";
export * from "./income";
export * from "./ledger";
export * from "./needs-you";
export * from "./notifications";
export * from "./platform";
export * from "./profile";
export * from "./push";
export * from "./recurring";
export * from "./search";
export * from "./settings";
export * from "./tokens";
export * from "./transfers";

/**
 * The whole /api/v1 contract. Each resource group registers here with one
 * line (S3b to S3d own their folders: `src/<group>/*`).
 */
export const contract = {
	categories: categoriesContract,
	currencies: currenciesContract,
	expenses: expensesContract,
	figures: figuresContract,
	income: incomeContract,
	"needs-you": needsYouContract,
	notifications: notificationsContract,
	platform: platformContract,
	profile: profileContract,
	recurring: recurringContract,
	push: pushContract,
	search: searchContract,
	settings: settingsContract,
	tokens: tokensContract,
	transfers: transfersContract,
};

export type Contract = typeof contract;
