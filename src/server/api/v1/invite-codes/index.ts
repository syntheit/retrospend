import * as invites from "~/server/services/api-v1/invite-codes";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const i = v1["invite-codes"];

export const inviteCodesRouter = {
	list: i.list.handler(
		serve(({ context, input }) => invites.listMine(signedIn(context), input)),
	),
	create: i.create.handler(
		serve(({ context }) => invites.createMine(signedIn(context))),
	),
	delete: i.delete.handler(
		serve(({ context, input }) =>
			invites.deleteMine(signedIn(context), input.id),
		),
	),
};
