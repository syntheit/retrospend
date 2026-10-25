import * as z from "zod";
import { currencyCodeSchema, moneySchema } from "../common/money";
import { userText } from "../common/user-text";
import { idSchema, timestampSchema } from "../core";
import { daySchema } from "../ledger";

export const ACCOUNT_TYPES = [
	"CASH",
	"INVESTMENT",
	"CRYPTO",
	"REAL_ESTATE",
	"VEHICLE",
	"LIABILITY_LOAN",
	"LIABILITY_CREDIT_CARD",
	"LIABILITY_MORTGAGE",
] as const;

export const accountTypeSchema = z
	.enum(ACCOUNT_TYPES)
	.meta({ id: "AccountType" });

/** Balance columns are Decimal(19,8): 11 digits before the point, 8 after. */
export const BALANCE_TEXT_PATTERN = /^-?\d{1,11}(\.\d{1,8})?$/;

export const balanceTextSchema = z
	.string()
	.regex(
		BALANCE_TEXT_PATTERN,
		"Use digits and at most 8 decimals, like 1234.56",
	)
	.meta({
		id: "BalanceText",
		description:
			"A balance as decimal text in the account's currency, as typed: what you hold, or what you owe on a liability. Zero and a minus sign are allowed.",
		examples: ["1234.56"],
	});

/** The account's stored rate is Decimal(18,6). */
export const accountRateTextSchema = z
	.string()
	.regex(
		/^\d{1,12}(\.\d{1,6})?$/,
		"Use digits and at most 6 decimals, like 1412.5",
	)
	.refine((v) => /[1-9]/.test(v), "Must be above zero")
	.meta({
		id: "AccountRateText",
		description:
			"A typed rate for the custom rate type: 1 USD (or 1 coin) is this many units of the account's currency.",
		examples: ["1412.5"],
	});

const percentTextSchema = z
	.string()
	.regex(/^\d{1,3}(\.\d{1,6})?$/, "A yearly rate like 24.5")
	.meta({ id: "PercentText", examples: ["24.5"] });

const minimumTextSchema = z
	.string()
	.regex(/^\d{1,11}(\.\d{1,8})?$/, "Use digits and at most 8 decimals")
	.meta({ id: "NonNegativeAmountText", examples: ["50"] });

const rateTypeNameSchema = z.string().min(1).max(32);

/** What a person fills in when they add or edit an account. */
export const accountFieldsSchema = z.object({
	name: userText("account.name", 191),
	type: accountTypeSchema,
	currency: z.string().length(3).meta({ description: "Three letters." }),
	balance: balanceTextSchema,
	rateType: rateTypeNameSchema.nullish().meta({
		description: "official, blue, mep, custom...; omitted: the default.",
	}),
	exchangeRate: accountRateTextSchema
		.nullish()
		.meta({ description: "Only for the custom rate type." }),
	isLiquid: z.boolean().default(false),
	interestRate: percentTextSchema.nullish(),
	minimumPayment: minimumTextSchema.nullish(),
	dueDay: z.int().min(1).max(31).nullish(),
	inBudget: z.boolean().nullish().meta({
		description:
			"Part of my budget; omitted keeps the default for its kind and currency.",
	}),
});

export const createAccountSchema = accountFieldsSchema
	.extend({
		id: z.uuid().optional().meta({
			description:
				"A client-made id. Sending the same id twice is a conflict, not a second account.",
		}),
	})
	.meta({ id: "CreateAccount" });

export const updateAccountSchema = accountFieldsSchema
	.extend({ id: idSchema })
	.meta({ id: "UpdateAccount" });

export const accountIdParamsSchema = z.object({ id: idSchema });

export const accountItemSchema = z
	.object({
		id: idSchema,
		name: z.string(),
		type: accountTypeSchema,
		currency: currencyCodeSchema,
		/** What it holds, or what you owe on a liability, in its own currency. */
		balance: moneySchema,
		/** Worth in the home currency today; liabilities are negative. Null: no rate for its currency (never 1). */
		value: moneySchema.nullable(),
		inBudget: z.boolean(),
		isLiquid: z.boolean(),
		rateType: z.string().nullable(),
		closedAt: timestampSchema.nullable(),
		interestRate: z
			.string()
			.nullable()
			.meta({ description: "Yearly percent as text." }),
		minimumPayment: moneySchema.nullable(),
		dueDay: z.int().nullable(),
		updatedAt: timestampSchema,
	})
	.meta({ id: "Account" });

export const accountListSchema = z
	.object({
		home: currencyCodeSchema,
		accounts: z.array(accountItemSchema),
	})
	.meta({ id: "AccountList" });

export const legSourceSchema = z.enum([
	"INCOME",
	"TRANSFER",
	"FEE",
	"BALANCE_UPDATE",
]);

export const accountLegSchema = z
	.object({
		id: idSchema,
		date: daySchema,
		source: legSourceSchema,
		/** Signed in what you have, in the account's currency. */
		amount: moneySchema,
		transferId: idSchema.nullable(),
		expenseId: idSchema.nullable(),
		/** A balance update's leg is its Not logged difference. */
		notLogged: z.boolean(),
	})
	.meta({ id: "AccountLeg" });

export const accountDetailSchema = accountItemSchema
	.extend({
		/** Units of the balance the budget already counts (a Move in). */
		countedUnits: moneySchema,
		rateTypeHistory: z.array(
			z.object({ from: daySchema, type: z.string().nullable() }),
		),
		/** The newest 200 legs. */
		legs: z.array(accountLegSchema),
	})
	.meta({ id: "AccountDetail" });

export const NET_WORTH_PARTS = [
	"income",
	"spending",
	"exchange",
	"notLogged",
	"revaluation",
	"opened",
	"closed",
] as const;

export const netWorthQuerySchema = z.object({
	days: z.coerce
		.number()
		.int()
		.min(1)
		.max(366)
		.default(90)
		.meta({ description: "How many days the series covers, ending today." }),
	changeDays: z.coerce
		.number()
		.int()
		.min(1)
		.max(366)
		.default(30)
		.meta({ description: "The span the change breakdown covers." }),
});

export const netWorthSchema = z
	.object({
		currency: currencyCodeSchema,
		/** Null when a rate is missing (never 1). */
		netWorth: moneySchema.nullable(),
		/** Why net worth moved over `changeDays`; the parts add up to the total. Null when a rate is missing. */
		change: z
			.object({
				days: z.int(),
				total: moneySchema,
				parts: z.object(
					Object.fromEntries(NET_WORTH_PARTS.map((p) => [p, moneySchema])) as {
						[K in (typeof NET_WORTH_PARTS)[number]]: typeof moneySchema;
					},
				),
			})
			.nullable(),
		/** One point a day: accounts and Not tracked on that day, with what people owe each other at today's value. Null on a day a rate is missing. */
		series: z.array(
			z.object({ date: daySchema, value: moneySchema.nullable() }),
		),
	})
	.meta({ id: "NetWorth" });

export const defaultAccountsSchema = z
	.object({
		defaults: z.record(z.string(), idSchema),
	})
	.meta({ id: "DefaultAccounts" });

export const setDefaultAccountSchema = z.object({
	currency: z.string().min(3).max(10),
	accountId: idSchema.nullable(),
});

export const exportCsvSchema = z.object({ csv: z.string() });

// ── Write inputs and results ────────────────────────────────────────────────

export const updateBalanceSchema = z
	.object({
		id: idSchema,
		balance: balanceTextSchema,
		rateType: rateTypeNameSchema.nullish().meta({
			description: "A new rate type switches from today.",
		}),
		exchangeRate: accountRateTextSchema.nullish(),
	})
	.meta({ id: "UpdateBalance" });

const rateSwitchSchema = z.object({
	rateTypeId: idSchema,
	from: daySchema,
	rateType: z.string().nullable(),
	/** The type days before `from` keep. */
	earlier: z.string().nullable(),
	/** What the switch did to the account's value on its day; null when a rate is missing. */
	revaluation: moneySchema.nullable(),
});

export const balanceUpdateSchema = z
	.object({
		accountId: idSchema,
		name: z.string(),
		before: moneySchema,
		after: moneySchema,
		/** The Not logged difference in what you have; zero when the balance was already right. */
		notLogged: moneySchema,
		rateSwitch: rateSwitchSchema.nullable(),
		/** The Not logged leg this wrote; null when the balance was already right. */
		legId: idSchema.nullable(),
		/** The account's stored rate before the update. */
		previousRate: z.string().nullable(),
	})
	.meta({ id: "BalanceUpdate" });

export const setRateTypeSchema = z
	.object({
		id: idSchema,
		rateType: rateTypeNameSchema.nullable().meta({
			description: "Null is the default pick.",
		}),
		from: daySchema.nullish().meta({ description: "Today when omitted." }),
	})
	.meta({ id: "SetAccountRateType" });

export const rateTypeSwitchSchema = rateSwitchSchema.meta({
	id: "RateTypeSwitch",
});

export const accountRemovedSchema = z.object({ id: idSchema });

export const accountBalanceRevertedSchema = z.object({
	accountId: idSchema,
	balance: moneySchema,
});

export const accountRateRevertedSchema = z.object({
	accountId: idSchema,
	rateType: z.string().nullable(),
});
