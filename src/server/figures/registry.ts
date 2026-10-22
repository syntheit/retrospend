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
import type { Prisma } from "~prisma";

/** The money DTO used everywhere (§2.2): integer minor units, never a float amount. */
export interface Money {
	readonly minor: number;
	readonly currency: string;
}

/** The optional narrowings a snapshot can carry on top of its user. */
export type ScopeKey = "projectId" | "personId" | "accountId";

export type FigureNarrowing = Partial<Record<ScopeKey, string>>;

/** A figure is always read for one user, optionally narrowed to one project, person or account. */
export type FigureScope = FigureNarrowing & { readonly userId: string };

/**
 * What a figure reads through: the user-scoped client for plain reads, or the
 * open transaction during a preview, so it sees the mutation's uncommitted rows.
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
	readonly compute: (db: Db, scope: FigureScope) => Promise<Money | null>;
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
function checkMoney(id: string, value: Money | null): Money | null {
	if (value === null) return null;
	if (!Number.isSafeInteger(value.minor)) {
		throw new FigureError(id, `minor ${value.minor} is not a safe integer`);
	}
	if (value.currency.length === 0) {
		throw new FigureError(id, "currency is empty");
	}
	return { minor: value.minor, currency: value.currency };
}

/** The one way to read a figure: narrowed scope, validated output, failures named by id. */
export async function readFigure<Db>(
	definition: FigureDefinition<Db>,
	db: Db,
	scope: FigureScope,
): Promise<Money | null> {
	let value: Money | null;
	try {
		value = await definition.compute(db, narrowScope(scope, definition.scope));
	} catch (error) {
		throw new FigureError(definition.id, "compute failed", { cause: error });
	}
	return checkMoney(definition.id, value);
}

/** Every figure in the product. Track 2A and later tracks add their definitions here. */
export const figures = createFiguresRegistry<FigureDb>([]);
