/**
 * Figures registry: one definition per number (IMPLEMENTATION §2.4).
 *
 * Every named number the product shows (`spent`, `owed.owedToYou`, `netWorth`,
 * ...) is registered here exactly once, under a stable id. Web, /api/v1, the
 * previews and the e2e display audit all read figures through this list, so
 * two screens can never compute the same number two ways.
 *
 * To add a figure: write its function in `src/server/services/figures/*`,
 * add its definition to `figures` at the bottom of this file, and give it a
 * test whose title is the plain string literal `"figure <id>"`, for example
 * `describe("figure owed.owedToYou", ...)` in any `*.test.ts` file under `src`.
 * registry.test.ts scans test sources for that literal and fails for any
 * registered id without one, so keep the title a literal, not a template.
 */

import { MissingRateError } from "~/lib/money";
import { accountFigures } from "~/server/services/accounts/figures";
import { budgetFigures } from "~/server/services/envelope/figures";
import { glanceFigures } from "~/server/services/figures/spend-pace";
import { spentFigure } from "~/server/services/figures/spent";
import { insightsFigures } from "~/server/services/insights/figures";
import {
	balancePersonFigure,
	owedToYouFigure,
	youOweFigure,
} from "~/server/services/payments/figures";
import { projectFigures } from "~/server/services/project/figures";
import type { Prisma } from "~prisma";
import { FigureUnavailable } from "./unavailable";

/** The money DTO used everywhere (§2.2): integer minor units, never a float amount. */
// Moves to @retrospend/domain when that package lands.
export interface Money {
	readonly minor: number;
	readonly currency: string;
}

/**
 * What a figure computes: one amount, or a per-currency list (at most one
 * entry per currency) for numbers that are never netted across currencies,
 * like a balance with someone in ARS and USD.
 */
export type FigureValue = Money | readonly Money[];

/** A figure as read: always a per-currency list, or null when unavailable. */
export type FigureReading = readonly Money[] | null;

/** The optional narrowings a snapshot can carry on top of its user. */
export type ScopeKey =
	| "projectId"
	| "personId"
	| "accountId"
	| "envelopeId"
	| "categoryId"
	/** A fiscal month label, "2026-10". */
	| "month";

export type FigureNarrowing = Partial<Record<ScopeKey, string>>;

/** A figure is always read for one user, optionally narrowed to one project, person, account, envelope, category or month. */
export type FigureScope = FigureNarrowing & { readonly userId: string };

/**
 * What a figure reads through: always an open transaction with RLS set.
 * Plain reads go through readFigures (figures/read.ts), which opens a
 * userTransaction, so even `$queryRaw` runs under RLS; a preview passes its
 * own transaction, so figures see the mutation's uncommitted rows.
 */
export type FigureDb = Prisma.TransactionClient;

export interface FigureDefinition<Db = FigureDb> {
	/** Stable dotted id. The UI tags the rendered number with it (`data-figure`) and the audit reads it back. */
	readonly id: string;
	/**
	 * The narrowings this figure honors. Any other key in a scope is dropped
	 * before the call, so `netWorth` read in a person-scoped preview is still
	 * the whole user's net worth.
	 */
	readonly scope: readonly ScopeKey[];
	/** Checked by every preview, declared or not, so a sheet can say "Your accounts and net worth: no change" (R30). */
	readonly inEveryPreview?: boolean;
	/** Returns null when the number is unavailable (for example a missing rate, R14). Throws only on bugs. */
	readonly compute: (
		db: Db,
		scope: FigureScope,
		/** The read pass; readFigure always passes one. */
		pass?: FigurePass,
	) => Promise<FigureValue | FigureUnavailable | null>;
}

export { FigureUnavailable };

/**
 * One read pass (one `readFiguresIn` call): figures computed from the same
 * load share it through `once`, so eight parts of one breakdown load their
 * rows once. It never outlives the pass, so a preview's before and after
 * (two passes around a write) never share a load.
 */
export class FigurePass {
	private readonly loads = new Map<string, Promise<unknown>>();
	private readonly missing = new Map<string, readonly string[]>();

	/** Notes the currencies that kept figure `id` unavailable. */
	noteMissing(id: string, currencies: readonly string[]) {
		this.missing.set(id, [...new Set(currencies)].sort());
	}

	/** Currencies whose missing rate kept figure `id` (or any figure) out. */
	missingRates(id?: string): string[] {
		const lists = id
			? [this.missing.get(id) ?? []]
			: [...this.missing.values()];
		return [...new Set(lists.flat())].sort();
	}

	once<T>(key: string, load: () => Promise<T>): Promise<T> {
		let pending = this.loads.get(key) as Promise<T> | undefined;
		if (!pending) {
			pending = load();
			this.loads.set(key, pending);
		}
		return pending;
	}
}

export interface FiguresRegistry<Db = FigureDb> {
	readonly ids: readonly string[];
	/** Ids every preview checks besides the ones a mutation declares. */
	readonly inEveryPreview: readonly string[];
	get(id: string): FigureDefinition<Db>;
}

/** A broken registry or a lookup of an id nobody registered: a programming error, caught by tests. */
export class FigureRegistryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FigureRegistryError";
	}
}

/** A figure threw or returned something that is not a Money; carries the id so the failing figure is obvious. */
export class FigureError extends Error {
	constructor(
		public readonly figureId: string,
		message: string,
		options?: ErrorOptions,
	) {
		super(`Figure ${figureId}: ${message}`, options);
		this.name = "FigureError";
	}
}

const FIGURE_ID = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/;

export function createFiguresRegistry<Db>(
	definitions: readonly FigureDefinition<Db>[],
): FiguresRegistry<Db> {
	const byId = new Map<string, FigureDefinition<Db>>();
	for (const definition of definitions) {
		if (!FIGURE_ID.test(definition.id)) {
			throw new FigureRegistryError(
				`"${definition.id}" is not a dotted camelCase figure id`,
			);
		}
		if (byId.has(definition.id)) {
			throw new FigureRegistryError(
				`two figures claim the id "${definition.id}"`,
			);
		}
		byId.set(definition.id, definition);
	}
	return {
		ids: [...byId.keys()],
		inEveryPreview: definitions
			.filter((definition) => definition.inEveryPreview)
			.map((definition) => definition.id),
		get(id) {
			const definition = byId.get(id);
			if (!definition) {
				throw new FigureRegistryError(`no figure is registered as "${id}"`);
			}
			return definition;
		},
	};
}

/** Keeps the user and only the narrowings the figure declares. */
export function narrowScope(
	scope: FigureScope,
	keys: readonly ScopeKey[],
): FigureScope {
	const narrowing: FigureNarrowing = {};
	for (const key of keys) {
		const value = scope[key];
		if (value !== undefined) narrowing[key] = value;
	}
	return { ...narrowing, userId: scope.userId };
}

/** Rejects a float or unsafe minor amount here, before it reaches a diff or a client. */
function checkMoney(id: string, money: Money): Money {
	if (!Number.isSafeInteger(money.minor)) {
		throw new FigureError(id, `minor ${money.minor} is not a safe integer`);
	}
	if (money.currency.length === 0) {
		throw new FigureError(id, "currency is empty");
	}
	return { minor: money.minor, currency: money.currency };
}

const byCurrency = (a: Money, b: Money) =>
	a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0;

/**
 * One list shape for every figure, sorted by currency code so the same
 * holdings always read the same way, whatever order a query returned them in.
 */
function toReading(id: string, value: FigureValue | null): FigureReading {
	if (value === null) return null;
	const list = "currency" in value ? [value] : value;
	const seen = new Set<string>();
	const reading = list.map((money) => {
		if (seen.has(money.currency)) {
			throw new FigureError(id, `lists ${money.currency} twice`);
		}
		seen.add(money.currency);
		return checkMoney(id, money);
	});
	return reading.sort(byCurrency);
}

/** The one way to read a figure: narrowed scope, validated output, failures named by id. */
export async function readFigure<Db>(
	definition: FigureDefinition<Db>,
	db: Db,
	scope: FigureScope,
	pass: FigurePass = new FigurePass(),
): Promise<FigureReading> {
	let value: FigureValue | FigureUnavailable | null;
	try {
		value = await definition.compute(
			db,
			narrowScope(scope, definition.scope),
			pass,
		);
	} catch (error) {
		if (!(error instanceof MissingRateError))
			throw new FigureError(definition.id, "compute failed", { cause: error });
		value = new FigureUnavailable(error.currencies);
	}
	if (value instanceof FigureUnavailable) {
		pass.noteMissing(definition.id, value.missingRates);
		return null;
	}
	return toReading(definition.id, value);
}

/** Reads figures one at a time: a transaction holds one connection, so parallel reads would only queue. */
export async function readFiguresIn<Db>(
	db: Db,
	definitions: readonly FigureDefinition<Db>[],
	scope: FigureScope,
	/** Pass one to read back which currencies kept a figure out. */
	pass: FigurePass = new FigurePass(),
): Promise<ReadonlyMap<string, FigureReading>> {
	const readings = new Map<string, FigureReading>();
	for (const definition of definitions) {
		readings.set(definition.id, await readFigure(definition, db, scope, pass));
	}
	return readings;
}

/** Every figure in the product. Track 2A and later tracks add their definitions here. */
export const figures = createFiguresRegistry<FigureDb>([
	spentFigure,
	balancePersonFigure,
	owedToYouFigure,
	youOweFigure,
	...projectFigures,
	...accountFigures,
	...budgetFigures,
	...glanceFigures,
	...insightsFigures,
]);
