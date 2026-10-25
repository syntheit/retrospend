import {
	ACTIVITY_KINDS,
	FREQUENCIES,
	NEEDS_YOU_GROUPS,
	NEEDS_YOU_TYPES,
	TRANSFER_KINDS,
} from "@retrospend/api-contract";
import { describe, expect, it } from "vitest";
import { ACTIVITY_KINDS as SERVER_ACTIVITY_KINDS } from "~/server/services/expense-list/types";
import { CATALOG } from "~/server/services/needs-you/catalog";
import { NEEDS_YOU_GROUPS as SERVER_GROUPS } from "~/server/services/needs-you/types";
import { RecurringFrequency, TransferKind } from "~prisma";

/** The contract package cannot import the server, so it mirrors these lists; this keeps them equal. */
describe("G2 contract mirrors", () => {
	it("activity kinds", () => {
		expect([...ACTIVITY_KINDS]).toEqual([...SERVER_ACTIVITY_KINDS]);
	});
	it("transfer kinds", () => {
		expect([...TRANSFER_KINDS].sort()).toEqual(
			Object.values(TransferKind).sort(),
		);
	});
	it("recurring frequencies", () => {
		expect([...FREQUENCIES].sort()).toEqual(
			Object.values(RecurringFrequency).sort(),
		);
	});
	it("needs-you groups and types", () => {
		expect([...NEEDS_YOU_GROUPS]).toEqual([...SERVER_GROUPS]);
		expect([...NEEDS_YOU_TYPES].sort()).toEqual(Object.keys(CATALOG).sort());
	});
});
