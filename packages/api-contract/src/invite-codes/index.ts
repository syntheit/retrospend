import * as z from "zod";
import { v1 } from "../common/meta";
import { idParamsSchema, idSchema, okSchema, timestampSchema } from "../core";

export const INVITE_STATUS_FILTERS = ["all", "active", "used"] as const;

export const inviteCodeListQuerySchema = z.object({
	status: z.enum(INVITE_STATUS_FILTERS).default("active"),
	cursor: z.string().min(1).max(512).optional(),
	limit: z.coerce.number().int().min(1).max(100).default(10),
});

const personRefSchema = z.object({
	username: z.string().nullable(),
	name: z.string(),
});

export const inviteCodeSchema = z
	.object({
		id: idSchema,
		code: z.string(),
		state: z.enum(["active", "used"]),
		isActive: z.boolean(),
		createdAt: timestampSchema,
		usedAt: timestampSchema.nullable(),
		expiresAt: timestampSchema.nullable(),
		createdBy: personRefSchema,
		/** Who signed up with it; null while unused. */
		usedBy: personRefSchema.nullable(),
	})
	.meta({ id: "InviteCode" });

export type InviteCodeDto = z.infer<typeof inviteCodeSchema>;

export const inviteCodePageSchema = z.object({
	items: z.array(inviteCodeSchema),
	nextCursor: z.string().nullable(),
});

const TAG = ["Invite codes"];

/**
 * Your own invite codes. They exist only while an admin lets every user
 * invite (the allowAllUsersToGenerateInvites setting); otherwise every
 * route answers 403.
 */
export const inviteCodesContract = {
	list: v1
		.route({
			method: "GET",
			path: "/invite-codes",
			operationId: "listInviteCodes",
			tags: TAG,
			summary: "Invite codes you created, newest first",
		})
		.meta({ scope: "read" })
		.input(inviteCodeListQuerySchema)
		.output(inviteCodePageSchema),
	create: v1
		.route({
			method: "POST",
			path: "/invite-codes",
			operationId: "createInviteCode",
			tags: TAG,
			summary: "Create an invite code",
			successStatus: 201,
		})
		.meta({ scope: "write:settings", event: "invite_code.created" })
		.output(inviteCodeSchema),
	delete: v1
		.route({
			method: "DELETE",
			path: "/invite-codes/{id}",
			operationId: "deleteInviteCode",
			tags: TAG,
			summary: "Delete one of your invite codes",
		})
		.meta({ scope: "write:settings", event: "invite_code.deleted" })
		.input(idParamsSchema)
		.output(okSchema),
};
