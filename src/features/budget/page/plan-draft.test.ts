import { TRPCClientError } from "@trpc/client";
import { describe, expect, it } from "vitest";
import { isPlanConflict, planSaveId } from "./plan-draft";

const refused = (code: string) =>
	new TRPCClientError("refused", {
		result: { error: { message: "refused", code: -1, data: { code } } },
	} as never);

describe("plan saves", () => {
	it("edit the open draft by its id", () => {
		expect(planSaveId({ open: { id: "open-1" } }, () => "new")).toBe("open-1");
	});

	it("start a new draft when only the applied plan is there, never under its id", () => {
		expect(planSaveId({ open: null }, () => "new")).toBe("new");
		expect(planSaveId(undefined, () => "new")).toBe("new");
	});

	it("read the plan again when the server says it moved on", () => {
		expect(isPlanConflict(refused("CONFLICT"))).toBe(true);
		expect(isPlanConflict(refused("BAD_REQUEST"))).toBe(false);
		expect(isPlanConflict(new Error("offline"))).toBe(false);
	});
});
