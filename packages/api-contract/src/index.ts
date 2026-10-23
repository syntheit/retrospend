import { categoriesContract } from "./categories";
import { currenciesContract } from "./currencies";
import { figuresContract } from "./figures";
import { notificationsContract } from "./notifications";
import { platformContract } from "./platform";
import { profileContract } from "./profile";
import { pushContract } from "./push";
import { searchContract } from "./search";
import { settingsContract } from "./settings";
import { tokensContract } from "./tokens";

export * from "./categories";
export * from "./common";
export * from "./core";
export * from "./currencies";
export * from "./figures";
export * from "./notifications";
export * from "./platform";
export * from "./profile";
export * from "./push";
export * from "./search";
export * from "./settings";
export * from "./tokens";

/**
 * The whole /api/v1 contract. Each resource group registers here with one
 * line (S3b to S3d own their folders: `src/<group>/*`).
 */
export const contract = {
	categories: categoriesContract,
	currencies: currenciesContract,
	figures: figuresContract,
	notifications: notificationsContract,
	platform: platformContract,
	profile: profileContract,
	push: pushContract,
	search: searchContract,
	settings: settingsContract,
	tokens: tokensContract,
};

export type Contract = typeof contract;
