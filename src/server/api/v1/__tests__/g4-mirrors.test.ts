import { ACCOUNT_TYPES, legSourceSchema } from "@retrospend/api-contract";
import { describe, expect, it } from "vitest";
import { AccountLegSource, AssetType } from "~prisma";

/** The contract package cannot import Prisma, so it mirrors these lists; this keeps them equal. */
describe("G4 contract mirrors", () => {
	it("account types", () => {
		expect([...ACCOUNT_TYPES].sort()).toEqual(Object.values(AssetType).sort());
	});
	it("account leg sources", () => {
		expect([...legSourceSchema.options].sort()).toEqual(
			Object.values(AccountLegSource).sort(),
		);
	});
});
