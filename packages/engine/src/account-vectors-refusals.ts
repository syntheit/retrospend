/** The refusals of typed numbers, in the route's words. See account-vectors-typed.ts and account-vectors.ts. */
import { type AccountVector, ARS, NOV10, uuid } from "./account-vector-types";

/** The words of the route's schemas (api-contract accounts/schemas.ts). */
const BALANCE_SHAPE = "Use digits and at most 8 decimals, like 1234.56";
const RATE_SHAPE = "Use digits and at most 6 decimals, like 1412.5";
const PERCENT_SHAPE = "A yearly rate like 24.5";

const newAccount = (over: Record<string, unknown>) =>
	({
		kind: "accountCreate",
		body: {
			id: uuid(190),
			name: "Acct",
			type: "CASH",
			currency: "USD",
			balance: "10",
			rateType: "blue",
			isLiquid: true,
			...over,
		},
	}) as const;

const refused = (refusedWith: string) => ({ refused: refusedWith });

export const refusalVectors: AccountVector[] = [
	{
		// Each refusal is the route's: its schema first (a balance of 12 integer
		// digits, a rate of 7 decimals, a percent of 4 digits), then the digits a
		// double can hold (17 for a BTC balance, 18 for a rate or a payment).
		// The words are the schema's and the domain's; nothing is stored.
		name: "typed numbers are refused as the route refuses them",
		seed: ARS,
		accounts: [
			{
				id: uuid(140),
				name: "Typed",
				type: "CASH",
				currency: "BRL",
				balance: "100",
				exchangeRate: "5.5",
				exchangeRateType: "custom",
			},
		],
		steps: [
			{
				now: NOV10,
				op: newAccount({
					currency: "BRL",
					rateType: "custom",
					exchangeRate: "5.1234567",
				}),
				expect: refused(RATE_SHAPE),
			},
			{
				now: NOV10,
				op: newAccount({ balance: "123456789012" }),
				expect: refused(BALANCE_SHAPE),
			},
			{
				// Two things wrong: the answer names the first the schema meets.
				now: NOV10,
				op: newAccount({
					currency: "BRL",
					balance: "123456789012",
					rateType: "custom",
					exchangeRate: "5.1234567",
				}),
				expect: refused(BALANCE_SHAPE),
			},
			{
				now: NOV10,
				op: newAccount({ interestRate: "1234" }),
				expect: refused(PERCENT_SHAPE),
			},
			{
				now: NOV10,
				op: newAccount({
					currency: "BTC",
					type: "CRYPTO",
					balance: "123456789.12345678",
					rateType: "custom",
					exchangeRate: "60000",
				}),
				expect: refused(
					"balance 123456789.12345678 has too many digits to split exactly",
				),
			},
			{
				now: NOV10,
				op: newAccount({
					currency: "BRL",
					rateType: "custom",
					exchangeRate: "123456789012.123456",
				}),
				expect: refused(
					"exchangeRate 123456789012.123456 has too many digits to keep exactly",
				),
			},
			{
				now: NOV10,
				op: newAccount({
					currency: "BTC",
					type: "LIABILITY_LOAN",
					balance: "1",
					rateType: "custom",
					exchangeRate: "60000",
					minimumPayment: "123456789.12345678",
				}),
				expect: refused(
					"minimumPayment 123456789.12345678 has too many digits to split exactly",
				),
			},
			{
				now: NOV10,
				op: {
					kind: "accountBalance",
					body: {
						id: uuid(140),
						balance: "100",
						rateType: "custom",
						exchangeRate: "5.1234567",
						legId: uuid(141),
						rateTypeId: uuid(142),
					},
				},
				expect: refused(RATE_SHAPE),
			},
			{
				now: NOV10,
				op: {
					kind: "accountBalance",
					body: {
						id: uuid(140),
						balance: "100",
						rateType: "custom",
						exchangeRate: "123456789012.123456",
						legId: uuid(141),
						rateTypeId: uuid(142),
					},
				},
				expect: refused(
					"exchangeRate 123456789012.123456 has too many digits to keep exactly",
				),
			},
			{
				// An edit alone: the account exists, the payment has 3 decimals.
				now: NOV10,
				op: {
					kind: "accountUpdate",
					body: {
						id: uuid(140),
						name: "Typed",
						type: "CASH",
						currency: "BRL",
						balance: "100",
						rateType: "custom",
						exchangeRate: "5.5",
						isLiquid: true,
						minimumPayment: "1.234",
						legId: uuid(143),
						rateTypeId: uuid(144),
					},
				},
				expect: refused(
					"minimumPayment 1.234 has more decimals than BRL allows (2)",
				),
			},
			{
				now: NOV10,
				op: {
					kind: "accountUpdate",
					body: {
						id: uuid(140),
						name: "Typed",
						type: "CASH",
						currency: "BRL",
						balance: "123456789012",
						rateType: "custom",
						exchangeRate: "5.5",
						isLiquid: true,
						legId: uuid(143),
						rateTypeId: uuid(144),
					},
				},
				expect: refused(BALANCE_SHAPE),
			},
			{
				now: NOV10,
				op: {
					kind: "accountRateType",
					body: {
						id: uuid(140),
						rateType: "official",
						from: "10/11/2026",
						rateTypeId: uuid(145),
					},
				},
				expect: refused("Invalid ISO date"),
			},
		],
	},
];
