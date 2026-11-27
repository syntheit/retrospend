import { ID_TAKEN_MESSAGE } from "@retrospend/domain/id-taken";
import { Prisma } from "~prisma";

/** Whether the unique key that failed is the row's id (its primary key). */
function idIsTheKey(error: Prisma.PrismaClientKnownRequestError): boolean {
	const meta = JSON.stringify(error.meta ?? {});
	return /"id"|_pkey/.test(meta);
}

/** A taken client id means an earlier try of the same write got through. */
export type UniqueProblem = "id_taken" | "conflict";

/**
 * The answer to a unique key violation, shared by tRPC and API v1: the code
 * and the sentence. Null for any other error.
 */
export function uniqueViolation(
	error: unknown,
): { problem: UniqueProblem; message: string } | null {
	if (
		!(error instanceof Prisma.PrismaClientKnownRequestError) ||
		error.code !== "P2002"
	)
		return null;
	return idIsTheKey(error)
		? { problem: "id_taken", message: ID_TAKEN_MESSAGE }
		: { problem: "conflict", message: "That id or name is already used" };
}
