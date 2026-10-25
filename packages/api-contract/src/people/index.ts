import * as z from "zod";
import { v1 } from "../common/meta";
import { cursorQuerySchema, pageOf } from "../common/pagination";
import { userText } from "../common/user-text";
import { idSchema } from "../core";
import {
	ledgerRowSchema,
	participantTypeSchema,
	peopleOverviewSchema,
	personPageSchema,
	personParamsSchema,
	settleContextQuerySchema,
	settleContextSchema,
} from "./schemas";

export * from "./schemas";

const TAG = ["People"];

export const createPersonSchema = z
	.object({
		id: z.uuid().optional().meta({
			description:
				"A client-made id. Sending the same id twice is a conflict, not a second person.",
		}),
		name: userText("person.name", 191),
		email: z.email().max(255).optional().meta({
			description:
				"An email is checked at most 20 times an hour. If it belongs to an account you already share expenses or a project with, the answer is that account. Any other email, with or without an account, adds a person with the email you typed, and the answer does not say which.",
		}),
	})
	.meta({ id: "CreatePerson" });

export const personCreatedSchema = z
	.object({
		type: participantTypeSchema,
		id: idSchema,
		name: z.string(),
		email: z.string().nullable(),
		/** True when the email is the account of someone you already share with, so no person was added. */
		existing: z.boolean(),
	})
	.meta({ id: "PersonCreated" });

export const renamePersonSchema = z
	.object({
		id: idSchema,
		name: userText("person.name", 191),
		email: z.email().max(255).optional().meta({
			description: "Left out: the email stays as it is.",
		}),
	})
	.meta({ id: "RenamePerson" });

export const renamedPersonSchema = z
	.object({ id: idSchema, name: z.string(), email: z.string().nullable() })
	.meta({ id: "RenamedPerson" });

export const claimLinkSchema = z
	.object({
		url: z.string(),
		token: z.string(),
		name: z.string(),
	})
	.meta({ id: "ClaimLink" });

export const personLedgerQuerySchema = personParamsSchema
	.extend(cursorQuerySchema.shape)
	.extend({
		projectId: idSchema.optional().meta({
			description: "Only the shared expenses of this project.",
		}),
	});

/**
 * People you share with. Balances are per person and per currency, never
 * netted across people or currencies. Settling up is under /payments.
 */
export const peopleContract = {
	list: v1
		.route({
			method: "GET",
			path: "/people",
			operationId: "listPeople",
			tags: TAG,
			summary: "People: balances, the bar and what waits for you",
			description:
				"Everyone you share expenses with, grouped (owed to you, you owe, pending, settled), with Owed to you and You owe as separate figures.",
		})
		.meta({ scope: "read" })
		.output(peopleOverviewSchema),
	get: v1
		.route({
			method: "GET",
			path: "/people/{type}/{id}",
			operationId: "getPerson",
			tags: TAG,
			summary:
				"One person: balance, projects, payments and the newest shared expenses",
		})
		.meta({ scope: "read" })
		.input(personParamsSchema)
		.output(personPageSchema),
	ledger: v1
		.route({
			method: "GET",
			path: "/people/{type}/{id}/ledger",
			operationId: "listPersonLedger",
			tags: TAG,
			summary: "Shared expenses with a person, newest first",
			description:
				"What each one does between you. The first page of GET /people/{type}/{id} already holds the newest.",
		})
		.meta({ scope: "read" })
		.input(personLedgerQuerySchema)
		.output(pageOf(ledgerRowSchema)),
	settle: v1
		.route({
			method: "GET",
			path: "/people/{type}/{id}/settle",
			operationId: "getSettleContext",
			tags: TAG,
			summary: "What the Settle up sheet needs about a person",
			description:
				"Open balances per project and currency, the way money should go and the amounts the sheet offers. Nothing is written; record with POST /payments.",
		})
		.meta({ scope: "read" })
		.input(personParamsSchema.extend(settleContextQuerySchema.shape))
		.output(settleContextSchema),
	create: v1
		.route({
			method: "POST",
			path: "/people",
			operationId: "createPerson",
			tags: TAG,
			summary: "Add a person who has no account",
			successStatus: 201,
		})
		.meta({ scope: "write:expenses", event: "person.created" })
		.input(createPersonSchema)
		.output(personCreatedSchema),
	rename: v1
		.route({
			method: "PATCH",
			path: "/people/shadow/{id}",
			operationId: "renamePerson",
			tags: TAG,
			summary: "Rename a person you added",
			description:
				"Only the person who added them can rename them, and only until they link an account.",
		})
		.meta({ scope: "write:expenses", event: "person.updated" })
		.input(renamePersonSchema)
		.output(renamedPersonSchema),
	claimLink: v1
		.route({
			method: "POST",
			path: "/people/shadow/{id}/claim-link",
			operationId: "createClaimLink",
			tags: TAG,
			summary: "A link that lets the person link their account",
			description:
				"The link is shown once and is not kept for replays. Editing the person revokes it.",
		})
		.meta({
			scope: "write:expenses",
			event: "person.claim_link_created",
			secretResponse: true,
		})
		.input(z.object({ id: idSchema }))
		.output(claimLinkSchema),
	remind: v1
		.route({
			method: "POST",
			path: "/people/{type}/{id}/remind",
			operationId: "remindPerson",
			tags: TAG,
			summary: "Remind someone about what they owe you",
			description:
				"A nudge to a person on Retrospend; it records nothing. One per person per 24 hours.",
		})
		.meta({ scope: "write:expenses", event: "person.reminded" })
		.input(personParamsSchema)
		.output(z.object({ ok: z.literal(true) })),
};
