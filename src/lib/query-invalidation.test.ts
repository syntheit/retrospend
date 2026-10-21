import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { handleMutationSuccess } from "./query-invalidation";

function invalidatedRouters(path: string[]): string[] {
	const invalidateQueries = vi.fn();
	handleMutationSuccess({ invalidateQueries } as unknown as QueryClient, {
		options: { mutationKey: [path] },
	});
	return invalidateQueries.mock.calls.map(
		(call) => (call[0] as { queryKey: string[][] }).queryKey[0]![0]!,
	);
}

describe("handleMutationSuccess", () => {
	it.each(["create", "settleAll", "confirm", "reject", "deletePending", "void"])(
		"settlement.%s refreshes project and people views",
		(procedure) => {
			const routers = invalidatedRouters(["settlement", procedure]);
			expect(routers).toEqual(
				expect.arrayContaining(["settlement", "project", "people", "billingPeriod"]),
			);
		},
	);
});
