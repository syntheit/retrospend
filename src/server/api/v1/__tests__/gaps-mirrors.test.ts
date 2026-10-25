import { AUDIT_ACTIONS, BILLING_CYCLES } from "@retrospend/api-contract";
import { describe, expect, it } from "vitest";
import { AuditAction, BillingCycleLength } from "~prisma";

/** The contract package cannot import Prisma, so it mirrors these lists; this keeps them equal. */
describe("gap-closing contract mirrors", () => {
	it("audit actions", () => {
		expect([...AUDIT_ACTIONS].sort()).toEqual(Object.values(AuditAction).sort());
	});
	it("billing cycles", () => {
		expect([...BILLING_CYCLES].sort()).toEqual(
			Object.values(BillingCycleLength).sort(),
		);
	});
});
