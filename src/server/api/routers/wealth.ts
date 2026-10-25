import { z } from "zod";
import { BASE_CURRENCY } from "~/lib/constants";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { readFigures } from "~/server/figures/read";
import {
	defaultAccounts,
	setDefaultAccount,
} from "~/server/services/accounts/defaults";
import { exactRate, withRateNumber } from "~/server/services/accounts/exact-rate";
import * as schema from "~/server/services/accounts/input";
import {
	closeAccount,
	createAccount,
	deleteAccount,
	editAccount,
	exportAccountsCsv,
	importAccounts,
	reopenAccount,
} from "~/server/services/accounts/manage";
import {
	revertRateType,
	setRateType,
} from "~/server/services/accounts/rate-type.mutation";
import { runwayStats } from "~/server/services/accounts/runway";
import {
	revertBalanceUpdate,
	updateBalance,
} from "~/server/services/accounts/update-balance.mutation";
import { accountView } from "~/server/services/accounts/view";
import { addIncome } from "~/server/services/income/add.mutation";
import {
	confirmRecurringIncome,
	unconfirmRecurringIncome,
} from "~/server/services/income/confirm-recurring.mutation";
import { deleteIncome } from "~/server/services/income/delete.mutation";
import { moveIn, undoMoveIn } from "~/server/services/income/move-in.mutation";
import { forUser } from "~/server/services/preview";
import type { MoneyMutation } from "~/server/services/preview/types";
import { createTransfer } from "~/server/services/transfers/create.mutation";
import { deleteTransfer } from "~/server/services/transfers/delete.mutation";
import { WealthService } from "~/server/services/wealth.service";

/**
 * A money mutation's two procedures (R30): `preview` runs it and rolls back,
 * `apply` runs the same code and commits. Both get the request's time zone.
 */
function money<I extends object, V>(
	schema: z.ZodType<I>,
	mutation: MoneyMutation<I & { timeZone?: string }, V>,
) {
	const withZone = (value: I, timeZone?: string) => ({ ...value, timeZone });
	return {
		preview: protectedProcedure
			.input(schema)
			.query(({ ctx, input }) =>
				forUser(ctx.session.user.id).preview(
					mutation,
					withZone(input as I, ctx.timeZone),
				),
			),
		save: protectedProcedure
			.input(schema)
			.mutation(({ ctx, input }) =>
				forUser(ctx.session.user.id).apply(
					mutation,
					withZone(input as I, ctx.timeZone),
				),
			),
	};
}

const byId = z.object({ id: z.cuid() });

/** Every figure this router serves: net worth, its 30-day change and parts, accounts, Not tracked. */
const WEALTH_FIGURES = [
	"netWorth",
	"netWorthChange.total",
	"netWorthChange.income",
	"netWorthChange.spending",
	"netWorthChange.exchange",
	"netWorthChange.notLogged",
	"netWorthChange.revaluation",
	"netWorthChange.opened",
	"netWorthChange.closed",
	"accounts.balance",
	"notTracked",
] as const;

export const wealthRouter = createTRPCRouter({
	createAsset: protectedProcedure
		.input(schema.createAccountSchema)
		.mutation(({ ctx, input }) =>
			createAccount(
				ctx.db,
				ctx.session.user.id,
				withRateNumber(input),
				ctx.timeZone,
			),
		),

	/** The old Update balance dialog; the same mutation as accounts.updateBalance. */
	updateAssetBalance: protectedProcedure
		.input(schema.legacyBalanceSchema)
		.mutation(async ({ ctx, input }) => {
			const { value } = await forUser(ctx.session.user.id).apply(
				updateBalance,
				{
					accountId: input.assetId,
					balance: String(input.newBalance),
					...(input.exchangeRateType
						? { rateType: input.exchangeRateType }
						: {}),
					exchangeRate:
						input.exchangeRate === undefined
							? null
							: exactRate(input.exchangeRate, "exchangeRate"),
					timeZone: ctx.timeZone,
				},
			);
			return value;
		}),

	updateAsset: protectedProcedure
		.input(schema.editAccountSchema)
		.mutation(({ ctx, input: { id, ...fields } }) =>
			editAccount(
				ctx.db,
				ctx.session.user.id,
				id,
				withRateNumber(fields),
				ctx.timeZone,
			),
		),

	getDashboard: protectedProcedure
		.input(z.object({ currency: z.string().length(3).optional() }).optional())
		.query(({ ctx, input }) =>
			new WealthService(ctx.db).getDashboardSummary(
				ctx.session.user.id,
				input?.currency ?? BASE_CURRENCY,
			),
		),

	getRunwayStats: protectedProcedure
		.input(z.object({ currency: z.string().length(3).optional() }).optional())
		.query(({ ctx, input }) =>
			runwayStats(
				ctx.db,
				ctx.session.user.id,
				input?.currency ?? BASE_CURRENCY,
			),
		),

	closeAsset: protectedProcedure
		.input(byId)
		.mutation(({ ctx, input }) =>
			closeAccount(ctx.db, ctx.session.user.id, input.id),
		),

	reopenAsset: protectedProcedure
		.input(byId)
		.mutation(({ ctx, input }) =>
			reopenAccount(ctx.db, ctx.session.user.id, input.id),
		),

	deleteAssetPermanently: protectedProcedure
		.input(byId)
		.mutation(({ ctx, input }) =>
			deleteAccount(ctx.db, ctx.session.user.id, input.id),
		),

	exportCsv: protectedProcedure.mutation(({ ctx }) =>
		exportAccountsCsv(ctx.db, ctx.session.user.id),
	),

	importAssets: protectedProcedure
		.input(schema.importAccountsSchema)
		.mutation(({ ctx, input }) =>
			importAccounts(ctx.db, ctx.session.user.id, input.rows, ctx.timeZone),
		),

	/** Net worth, its 30-day breakdown, account balances and Not tracked, from the figures registry. */
	figures: protectedProcedure.query(async ({ ctx }) => {
		const readings = await readFigures(ctx.session.user.id, WEALTH_FIGURES);
		return Object.fromEntries(readings);
	}),

	accounts: createTRPCRouter({
		view: protectedProcedure
			.input(z.object({ accountId: z.string().min(1) }))
			.query(({ ctx, input }) =>
				accountView(ctx.db, ctx.session.user.id, input.accountId),
			),
		updateBalance: createTRPCRouter(
			money(schema.updateBalanceSchema, updateBalance),
		),
		revertBalanceUpdate: createTRPCRouter(
			money(schema.revertBalanceUpdateSchema, revertBalanceUpdate),
		),
		setRateType: createTRPCRouter(money(schema.setRateTypeSchema, setRateType)),
		revertRateType: createTRPCRouter(
			money(z.object({ rateTypeId: z.string().min(1) }), revertRateType),
		),
		defaults: protectedProcedure.query(({ ctx }) =>
			defaultAccounts(ctx.db, ctx.session.user.id),
		),
		setDefault: protectedProcedure
			.input(schema.setDefaultAccountSchema)
			.mutation(({ ctx, input }) =>
				setDefaultAccount(
					ctx.db,
					ctx.session.user.id,
					input.currency,
					input.accountId,
				),
			),
	}),

	transfers: createTRPCRouter({
		create: createTRPCRouter(
			money(schema.createTransferSchema, createTransfer),
		),
		/** The undo of a delete: the same move back, with its own id. */
		recreate: createTRPCRouter(
			money(schema.recreateTransferSchema, createTransfer),
		),
		delete: createTRPCRouter(money(schema.transferIdSchema, deleteTransfer)),
	}),

	income: createTRPCRouter({
		add: createTRPCRouter(money(schema.addIncomeSchema, addIncome)),
		recreate: createTRPCRouter(money(schema.recreateIncomeSchema, addIncome)),
		delete: createTRPCRouter(money(schema.deleteIncomeSchema, deleteIncome)),
		moveIn: createTRPCRouter(money(schema.moveInSchema, moveIn)),
		undoMoveIn: createTRPCRouter(money(schema.moveInSchema, undoMoveIn)),
		confirmRecurring: createTRPCRouter(
			money(schema.confirmRecurringIncomeSchema, confirmRecurringIncome),
		),
		unconfirmRecurring: createTRPCRouter(
			money(schema.unconfirmRecurringIncomeSchema, unconfirmRecurringIncome),
		),
	}),
});
