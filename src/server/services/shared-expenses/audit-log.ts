import type {
	AuditAction,
	AuditTargetType,
	Prisma,
	PrismaClient,
} from "~prisma";
import type { ParticipantRef } from "./types";

export interface LogAuditParams {
	actor: ParticipantRef;
	action: AuditAction;
	targetType: AuditTargetType;
	targetId: string;
	changes?: Prisma.InputJsonValue;
	context?: Prisma.InputJsonValue;
	projectId?: string;
}

/**
 * Append-only audit log entry creation.
 * This is the only operation exposed: no update or delete.
 *
 * Can be called with either a PrismaClient or a TransactionClient
 * so it works inside interactive transactions.
 *
 * A failed write throws. Inside a transaction a refused or failed insert has
 * already aborted it, so swallowing the error only hid the real cause behind
 * "current transaction is aborted" on the next statement, or let the caller
 * report success for a change whose record is missing.
 */
export async function logAudit(
	db: PrismaClient | Prisma.TransactionClient,
	params: LogAuditParams,
): Promise<void> {
	await (db as PrismaClient).auditLogEntry.create({
		data: {
			actorType: params.actor.participantType,
			actorId: params.actor.participantId,
			action: params.action,
			targetType: params.targetType,
			targetId: params.targetId,
			changes: params.changes ?? undefined,
			context: params.context ?? undefined,
			projectId: params.projectId,
		},
	});
}
