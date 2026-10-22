import { figuresContract } from "./figures";
import { platformContract } from "./platform";

export * from "./common";
export * from "./figures";
export * from "./platform";

/**
 * The whole /api/v1 contract. Each resource group registers here with one
 * line (S3b to S3d own their folders: `src/<group>/*`).
 */
export const contract = {
	figures: figuresContract,
	platform: platformContract,
};

export type Contract = typeof contract;
