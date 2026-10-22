import { search } from "~/server/services/api-v1/search";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

export const searchRouter = {
	search: v1.search.search.handler(
		serve(({ context, input }) => search(signedIn(context), input)),
	),
};
