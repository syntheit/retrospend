import { figuresRouter } from "./figures";
import { v1 } from "./middleware";
import { platformRouter } from "./platform";

/**
 * The implemented /api/v1 router. Each resource group registers here with
 * one line, matching the contract index in packages/api-contract.
 */
export const v1Router = v1.router({
	figures: figuresRouter,
	platform: platformRouter,
});
