/**
 * The corrections reads for transports (tRPC now, /api/v1 later): each opens
 * one RLS transaction for the user. Writes go through the money mutations.
 */
import { db } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import { fixRequestsFor, lockStates } from "./fix-request.service";

/** The requests on a split that `userId` asked or was asked (nobody else sees them). */
export const fixRequestsOf = (userId: string, transactionId: string) =>
	userTransaction(db, userId, (tx) => fixRequestsFor(tx, transactionId));

/** What each split allows `userId`: its lock and who may correct or ask. */
export const lockStatesOf = (
	userId: string,
	transactionIds: readonly string[],
) =>
	userTransaction(db, userId, (tx) => lockStates(tx, userId, transactionIds));
