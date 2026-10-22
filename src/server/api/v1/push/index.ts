import * as push from "~/server/services/api-v1/push";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const p = v1.push;

export const pushRouter = {
	list: p.list.handler(
		serve(({ context, input }) =>
			push.listDevicePage(signedIn(context), input),
		),
	),
	register: p.register.handler(
		serve(({ context, input }) => push.register(signedIn(context), input)),
	),
	remove: p.remove.handler(
		serve(({ context, input }) => push.remove(signedIn(context), input.id)),
	),
};
