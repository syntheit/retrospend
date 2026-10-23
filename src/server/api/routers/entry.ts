import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { createTransferSchema } from "~/server/services/accounts/input";
import { entryCatalog } from "~/server/services/entry/catalog";
import {
	deleteExpenseEntry,
	updateExpenseEntry,
} from "~/server/services/entry/expense.mutation";
import * as schema from "~/server/services/entry/input";
import {
	createSharedExpense,
	deleteSharedExpense,
	updateSharedExpense,
} from "~/server/services/entry/shared.mutation";
import { rateOptionsView, transferView } from "~/server/services/entry/views";
import { createExpense } from "~/server/services/expense-create.mutation";
import { forUser } from "~/server/services/preview";
import type { MoneyMutation } from "~/server/services/preview/types";
import {
	getDefaultRateTypes,
	rateOptions,
	setDefaultRateType,
} from "~/server/services/rate-types";
import { createTransfer } from "~/server/services/transfers/create.mutation";

type Ctx = { session: { user: { id: string } }; timeZone?: string };
type Notify = (() => Promise<void>)[];

/**
 * A money mutation's pair (R30): `preview` runs it and rolls back, `save`
 * runs the same code and commits. `toInput` maps the transport shape onto
 * the service's and may hand `notify` to a write that queues notifications;
 * they go out only after a save.
 */
function money<S extends z.ZodType, I, V, O = V>(
	input: S,
	mutation: MoneyMutation<I, V>,
	toInput: (value: z.infer<S>, ctx: Ctx, notify: Notify) => I,
	view: (value: V) => O = (v) => v as unknown as O,
) {
	const run = async (ctx: Ctx, value: z.infer<S>, save: boolean) => {
		const notify: Notify = [];
		const runner = forUser(ctx.session.user.id);
		const args = toInput(value, ctx, notify);
		if (!save) {
			const out = await runner.preview(mutation, args);
			return { ...out, value: view(out.value), undo: null };
		}
		const out = await runner.apply(mutation, args);
		for (const send of notify) void send();
		return { ...out, value: view(out.value) };
	};
	return createTRPCRouter({
		preview: protectedProcedure
			.input(input)
			.query(({ ctx, input: value }) => run(ctx, value, false)),
		save: protectedProcedure
			.input(input)
			.mutation(({ ctx, input: value }) => run(ctx, value, true)),
	});
}

const asIs = <T>(value: T) => value;

/**
 * The Add family (4G): Add expense (personal and shared), Transfer and
 * Exchange, the rate strip and the default rate type. Add income uses
 * wealth.income.add, the same mutation with Use my plan.
 */
export const entryRouter = createTRPCRouter({
	/** Categories, recents, places and defaults: what the sheets read once. */
	catalog: protectedProcedure.query(({ ctx }) =>
		entryCatalog(ctx.db, ctx.session.user.id),
	),

	/** The rate strip: every type the pair offers, booked as saving would book it. */
	rateOptions: protectedProcedure
		.input(schema.rateOptionsSchema)
		.query(async ({ ctx, input }) =>
			rateOptionsView(
				input.currency,
				await rateOptions(ctx.db, ctx.session.user.id, {
					currency: input.currency,
					date: new Date(`${input.date}T12:00:00.000Z`),
					amount: input.amount === undefined ? undefined : Number(input.amount),
				}),
			),
		),

	/** The default rate type per home currency (N73); the strip starts on it. */
	defaultRateTypes: protectedProcedure.query(({ ctx }) =>
		getDefaultRateTypes(ctx.db, ctx.session.user.id),
	),
	setDefaultRateType: protectedProcedure
		.input(schema.defaultRateTypeSchema)
		.mutation(({ ctx, input }) =>
			setDefaultRateType(
				ctx.db,
				ctx.session.user.id,
				input.homeCurrency,
				input.rateType,
			),
		),

	expense: createTRPCRouter({
		create: money(schema.expenseFormSchema, createExpense, (v, c) =>
			schema.toExpenseInput(v, c.timeZone),
		),
		update: money(schema.expenseFormSchema, updateExpenseEntry, (v, c) =>
			schema.toExpenseInput(v, c.timeZone),
		),
		delete: money(z.object({ id: z.string().min(1) }), deleteExpenseEntry, asIs),
		/** Undo of a delete: the same expense back, same id. */
		restore: money(schema.expenseRestoreSchema, createExpense, asIs),
		/** Undo of an edit: the values it had. */
		revert: money(schema.expenseRestoreSchema, updateExpenseEntry, (v) => ({
			...v,
			amount: Number(v.amount),
		})),
	}),

	shared: createTRPCRouter({
		create: money(schema.sharedCreateSchema, createSharedExpense, (v, c, n) => ({
			...schema.toSharedInput(v, c.timeZone),
			notify: n,
		})),
		update: money(schema.sharedUpdateSchema, updateSharedExpense, (v, c, n) => ({
			...schema.toSharedInput(v, c.timeZone),
			notify: n,
		})),
		revert: money(schema.sharedRestoreSchema, updateSharedExpense, (v, _c, n) => ({
			...v,
			notify: n,
		})),
		delete: money(schema.sharedDeleteSchema, deleteSharedExpense, (v, _c, n) => ({
			...v,
			notify: n,
		})),
	}),

	/** Transfer and Exchange, with amounts and rates as Money for the sheet. */
	transfer: money(
		createTransferSchema,
		createTransfer,
		(v, c) => ({ ...v, timeZone: c.timeZone }),
		transferView,
	),
});
