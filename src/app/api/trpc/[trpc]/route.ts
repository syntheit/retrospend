import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { NextRequest } from "next/server";

import { describeInternalError } from "~/server/api/error-formatter";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a HTTP request (e.g. when you make requests from Client Components).
 */
const createContext = async (req: NextRequest) => {
	return createTRPCContext({
		headers: req.headers,
	});
};

const handler = (req: NextRequest) =>
	fetchRequestHandler({
		endpoint: "/api/trpc",
		req,
		router: appRouter,
		createContext: () => createContext(req),
		// The client gets a generic message for what the code did not plan for;
		// the server keeps a line about it.
		onError: ({ error, path }) => {
			if (error.code === "INTERNAL_SERVER_ERROR")
				console.error(describeInternalError(path, error));
		},
	});

export { handler as GET, handler as POST };
