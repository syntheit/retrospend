/**
 * What the shared expense service takes, split out of transaction.service.ts
 * to keep that file under its size limit.
 */
import type { ParticipantRef } from "./types";

export interface SplitParticipantInput {
	participantType: "user" | "guest" | "shadow";
	participantId: string;
	shareAmount?: number;
	sharePercentage?: number;
	shareUnits?: number;
}

export type SplitModeType = "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";

export interface CreateSharedTransactionInput {
	/** A client id: a repeated create (a double click) writes nothing twice. */ id?: string;
	amount: number;
	currency: string;
	description: string;
	categoryId?: string;
	date: Date;
	paidBy: ParticipantRef;
	splitWith: SplitParticipantInput[];
	splitMode: SplitModeType;
	projectId?: string;
	notes?: string;
	receiptUrl?: string;
}

export interface UpdateSharedTransactionInput {
	id: string;
	amount?: number;
	currency?: string;
	description?: string;
	categoryId?: string | null;
	/**
	 * `categoryId` comes from a record the server wrote and signed (the v1 undo
	 * token of an edit). Never set from a request body: the transport schemas
	 * do not carry it.
	 */
	restoredFromServerRecord?: boolean;
	date?: Date;
	paidBy?: ParticipantRef;
	splitWith?: SplitParticipantInput[];
	splitMode?: SplitModeType;
	projectId?: string | null;
	notes?: string | null;
	receiptUrl?: string | null;
	reopenFixRequests?: readonly { id: string; previousStatus: "PENDING" | "ACCEPTED" }[]; // undo of an edit that answered fix requests (2C.2)
}
