import { NextResponse } from "next/server";
import { PROBLEM_CONTENT_TYPE } from "@retrospend/api-contract/common";
import { encodeProblem, problem } from "~/server/api/v1/errors";
import { isProtected } from "@retrospend/api-contract/protection-state";

/**
 * The refusal a plain route handler gives a protected account: 403 with the
 * same problem body the API does. Returns null for an unprotected one, so a
 * route writes `const refused = refuseProtected(user); if (refused) return refused;`.
 */
export function refuseProtected(user: {
	protectionState?: unknown;
}): NextResponse | null {
	if (!isProtected(user.protectionState)) return null;
	return NextResponse.json(encodeProblem(problem("protected_account")), {
		status: 403,
		headers: { "content-type": PROBLEM_CONTENT_TYPE },
	});
}
