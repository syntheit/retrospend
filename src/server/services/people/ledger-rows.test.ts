/**
 * A person's ledger shows a split's faces in the one order every screen uses
 * (inFaceOrder): the payer first, then the rest by key, whatever order the
 * split rows came in.
 */
import { describe, expect, it } from "vitest";
import type { TransactionHistoryItem } from "~/server/services/shared-expenses/people.service";
import { ledgerRows } from "./ledger-rows";

const user = (id: string) => ({ participantType: "user", participantId: id });

const db = {
	sharedTransaction: {
		findMany: async () => [
			{
				id: "t1",
				amount: "90",
				currency: "ARS",
				paidByType: "user",
				paidById: "ben",
				splitParticipants: ["cam", "ana", "ben"].map((id) => ({
					...user(id),
					shareAmount: "30",
				})),
			},
		],
	},
} as unknown as Parameters<typeof ledgerRows>[0];

const item = {
	id: "t1",
	description: "Dinner",
	amount: 90,
	currency: "ARS",
	category: null,
	date: new Date("2026-10-09T12:00:00Z"),
	paidBy: { ...user("ben"), name: "Ben", avatarUrl: null, isMe: false },
	myVerificationStatus: "ACCEPTED",
	project: null,
	canEdit: false,
	splitParticipants: ["cam", "ana", "ben"].map((id) => ({
		...user(id),
		shareAmount: 30,
		name: id,
		avatarUrl: null,
	})),
} as unknown as TransactionHistoryItem;

describe("ledgerRows", () => {
	it("lists the payer's face first, then the rest by key", async () => {
		const [row] = await ledgerRows(db, [item], {
			mine: new Set(["user:ana"]),
			theirs: new Set(["user:ben"]),
		});
		expect(row?.people.map((p) => p.id)).toEqual([
			"user:ben",
			"user:ana",
			"user:cam",
		]);
	});
});
