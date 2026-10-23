import {
	createAccessToken,
	listAccessTokenPage,
	revokeAccessToken,
} from "~/server/services/api-v1/token.service";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const t = v1.tokens;

export const tokensRouter = {
	list: t.list.handler(
		serve(({ context, input }) =>
			listAccessTokenPage(signedIn(context), input),
		),
	),
	create: t.create.handler(
		serve(({ context, input }) => {
			const user = signedIn(context);
			return createAccessToken(user.db, user.principal, input);
		}),
	),
	revoke: t.revoke.handler(
		serve(({ context, input }) =>
			revokeAccessToken(signedIn(context), input.id),
		),
	),
};
