import * as z from "zod";
import { v1 } from "../common/meta";
import { undoTokenSchema } from "../common/preview";
import type { RouteScope } from "../common/scopes";
import { previewTwin } from "../ledger";

export const TAG = ["Budget"];

type Method = "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * What every budget money write answers: the engine's own result and an undo
 * token. The token is null for the few writes that cannot be taken back (the
 * first set-up, removing an Adjustment, undoing an undo); the route says so.
 */
export function writeOut<T extends z.ZodType>(result: T) {
	return z.object({
		result,
		undo: undoTokenSchema.nullable().meta({
			description:
				"Valid for 24 hours, once. Send it to POST /budget/undo. Null when this write cannot be taken back.",
		}),
	});
}

type WriteConfig<I extends z.ZodType, R extends z.ZodType> = {
	method?: Method;
	path: `/${string}`;
	operationId: string;
	previewId: string;
	summary: string;
	event: string;
	input: I;
	result: R;
	status?: 200 | 201;
	/** The route's scope; money writes are `write:money`. */
	scope?: RouteScope;
};

/**
 * A budget money write and its preview twin. The twin runs the same write in
 * a transaction that rolls back; its `detail` is `{ kind, result }` where
 * `result` is what the write would answer.
 */
export function moneyWrite<I extends z.ZodType, R extends z.ZodType>(
	c: WriteConfig<I, R>,
) {
	const method = c.method ?? "POST";
	const write = v1
		.route({
			method,
			path: c.path,
			operationId: c.operationId,
			tags: TAG,
			summary: c.summary,
			successStatus: c.status ?? 200,
		})
		.meta({ scope: c.scope ?? "write:money", event: c.event })
		.input(c.input)
		.output(writeOut(c.result));
	const preview = previewTwin({
		path: c.path,
		of: `${method} ${c.path}`,
		operationId: c.previewId,
		tags: TAG,
		scope: c.scope ?? "write:money",
		input: c.input,
	});
	return { write, preview };
}

/** A write that moves no money (a rule, a draft, a note on the plan): no preview, no undo token. */
export function planWrite<I extends z.ZodType, R extends z.ZodType>(c: {
	method?: Method;
	path: `/${string}`;
	operationId: string;
	summary: string;
	event: string;
	input: I;
	output: R;
	status?: 200 | 201;
	description?: string;
}) {
	return v1
		.route({
			method: c.method ?? "POST",
			path: c.path,
			operationId: c.operationId,
			tags: TAG,
			summary: c.summary,
			description: c.description,
			successStatus: c.status ?? 200,
		})
		.meta({ scope: "write:settings", event: c.event })
		.input(c.input)
		.output(c.output);
}

type ReadConfig = {
	path: `/${string}`;
	operationId: string;
	summary: string;
	description?: string;
};

const readRoute = (c: ReadConfig) =>
	v1
		.route({
			method: "GET",
			path: c.path,
			operationId: c.operationId,
			tags: TAG,
			summary: c.summary,
			description: c.description,
		})
		.meta({ scope: "read" });

/** A GET with a query or path input. */
export function budgetRead<I extends z.ZodType, R extends z.ZodType>(
	c: ReadConfig & { input: I; output: R },
) {
	return readRoute(c).input(c.input).output(c.output);
}

/** A GET with no input. */
export function budgetReadAll<R extends z.ZodType>(
	c: ReadConfig & { output: R },
) {
	return readRoute(c).output(c.output);
}
