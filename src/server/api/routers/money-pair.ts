/**
 * A money mutation as a router pair (R30): `preview` runs it and rolls back,
 * `save` runs the same code and commits. Notifications the write queues go
 * out only after a save, so a preview tells nobody.
 */
import type { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { forUser } from "~/server/services/preview";
import type { MoneyMutation } from "~/server/services/preview/types";

export type Notify = (() => Promise<void>)[];

interface Ctx {
	readonly session: { readonly user: { readonly id: string } };
	readonly timeZone?: string;
}

export function money<S extends z.ZodType, I, V>(
	input: S,
	mutation: MoneyMutation<I, V>,
	toInput: (value: z.infer<S>, ctx: Ctx, notify: Notify) => I,
) {
	return createTRPCRouter({
		preview: protectedProcedure
			.input(input)
			.mutation(({ ctx, input: value }) =>
				forUser(ctx.session.user.id).preview(
					mutation,
					toInput(value as z.infer<S>, ctx, []),
				),
			),
		save: protectedProcedure
			.input(input)
			.mutation(async ({ ctx, input: value }) => {
				const notify: Notify = [];
				const out = await forUser(ctx.session.user.id).apply(
					mutation,
					toInput(value as z.infer<S>, ctx, notify),
				);
				for (const send of notify) void send();
				return out;
			}),
	});
}
