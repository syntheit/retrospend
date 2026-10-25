import { TRPCError } from "@trpc/server";
import { currencyDecimals } from "@retrospend/domain/money";
import type { DraftDto } from "~/lib/schemas/envelope-plan";
import { userTransaction } from "~/server/db-tx";
import { homeCurrencyOf } from "~/server/services/accounts/ledger";
import { dec, fromMinor, toMinor } from "~/server/services/envelope/units";
import type { MoneyMutation } from "~/server/services/preview/types";
import { assertMinorUnits } from "../amounts";
import type { Caller } from "../caller";

/**
 * Money goes into v1 as decimal text, like every other group. The envelope
 * engine counts in integer minor units, so this is the one place that turns
 * text into minor units: with the currency's own decimals, refusing a digit
 * beyond them (400) and never rounding. The engine's schemas stay as they are.
 *
 * A v1 field is the engine's `<name>Minor` without the suffix (`amountMinor`
 * is `amount`, `startingMoneyMinor` is `startingMoney`). Its currency is the
 * `currency` of the object it sits in, else the budget's.
 */
const KEYS = [
	"amount",
	"startingMoney",
	"haveNow",
	"bank",
	"extraMonthly",
	"minimum",
	"principal",
	"interest",
	"monthly",
] as const;

const isAmountKey = (key: string): key is (typeof KEYS)[number] =>
	(KEYS as readonly string[]).includes(key);

type Cast<T> = null extends T ? string | null : string;

/** The engine's input as v1 takes it: every `<name>Minor` number is `<name>` text. */
export type Renamed<T> = T extends readonly (infer U)[]
	? Renamed<U>[]
	: T extends object
		? {
				[K in keyof T as K extends `${infer B}Minor`
					? B
					: K]: K extends `${string}Minor` ? Cast<T[K]> : Renamed<T[K]>;
			}
		: T;

export function minorOf(text: string, currency: string, field: string): number {
	assertMinorUnits(text, currency, field);
	try {
		return toMinor(dec(text), currency);
	} catch {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `${field} ${text} is too large`,
		});
	}
}

/** Walks a v1 input and gives the engine its minor units. */
export function toEngine(value: unknown, currency: string): unknown {
	if (Array.isArray(value)) return value.map((v) => toEngine(v, currency));
	if (value === null || typeof value !== "object") return value;
	const obj = value as Record<string, unknown>;
	const here = typeof obj.currency === "string" ? obj.currency : currency;
	return Object.fromEntries(
		Object.entries(obj).map(([key, v]) => {
			if (isAmountKey(key) && (typeof v === "string" || v === null))
				return [`${key}Minor`, v === null ? null : minorOf(v, here, key)];
			return [key, toEngine(v, here)];
		}),
	);
}

/** The other way: an engine value (or part of one) with its `<name>Minor` numbers as `<name>` text. */
export function fromEngine<T>(value: T, currency: string): Renamed<T> {
	const walk = (v: unknown, cur: string): unknown => {
		if (Array.isArray(v)) return v.map((x) => walk(x, cur));
		if (v === null || typeof v !== "object") return v;
		const obj = v as Record<string, unknown>;
		const here = typeof obj.currency === "string" ? obj.currency : cur;
		return Object.fromEntries(
			Object.entries(obj).map(([key, x]) => {
				const base = key.endsWith("Minor") ? key.slice(0, -5) : null;
				if (base && isAmountKey(base) && typeof x === "number")
					return [base, fromMinor(x, here).toFixed(currencyDecimals(here))];
				return [key, walk(x, here)];
			}),
		);
	};
	return walk(value, currency) as Renamed<T>;
}

/** The budget's currency, or the home currency before there is a book. */
export async function budgetCurrencyIn(
	tx: Parameters<typeof homeCurrencyOf>[0],
	userId: string,
): Promise<string> {
	const book = await tx.budgetBook.findFirst({
		where: { createdById: userId, isPersonal: true },
		select: { currency: true },
	});
	return book?.currency ?? homeCurrencyOf(tx, userId);
}

/**
 * The web's mutation behind v1's text amounts: the same run, the same
 * preview, with the input converted inside the transaction (the currency is
 * read there) and, where a value carries raw minor units, the answer shaped.
 */
export function v1Mutation<E, V, R = V>(
	mutation: MoneyMutation<E, V>,
	shape?: (value: V, currency: string) => R,
): MoneyMutation<Renamed<E>, R> {
	const { scope } = mutation;
	return {
		id: mutation.id,
		touches: mutation.touches,
		...(scope ? { scope: (i: Renamed<E>) => scope(i as unknown as E) } : {}),
		run: async (tx, input, actor) => {
			const currency = await budgetCurrencyIn(tx, actor.userId);
			const done = await mutation.run(
				tx,
				toEngine(input, currency) as E,
				actor,
			);
			return {
				value: shape
					? shape(done.value, currency)
					: (done.value as unknown as R),
				undo: done.undo,
			};
		},
	};
}

type MinorRow = { amountMinor: number };
const money = <T extends MinorRow>(
	{ amountMinor, ...rest }: T,
	currency: string,
) => ({
	...rest,
	amount: { minor: amountMinor, currency },
});

/** A draft's rows carry amounts; v1 answers them as Money in the book currency. */
export function draftOut(d: DraftDto, currency: string) {
	return {
		...d,
		lines: d.lines.map((r) => money(r, currency)),
		moves: d.moves.map((r) => money(r, currency)),
		expectedIn: d.expectedIn.map((r) => money(r, currency)),
		pretend: d.pretend.map((r) => money(r, currency)),
	};
}

/** The caller's budget currency, for reads that take or give amounts. */
export const budgetCurrencyOf = (caller: Caller) =>
	userTransaction(caller.db, caller.principal.userId, (tx) =>
		budgetCurrencyIn(tx, caller.principal.userId),
	);

/** A query amount as the engine's minor units, in the budget currency. */
export async function queryMinor(
	caller: Caller,
	text: string | undefined,
	field: string,
): Promise<number | undefined> {
	if (text === undefined) return undefined;
	return minorOf(text, await budgetCurrencyOf(caller), field);
}

/** A draft write's answer with the draft's rows as Money. */
export const draftResultOut = <V extends { draft: DraftDto }>(
	value: V,
	currency: string,
) => ({ ...value, draft: draftOut(value.draft, currency) });
