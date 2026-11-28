/**
 * category.create and category.update on the device: the writes the server
 * makes through one mutation (src/server/services/category/create.mutation.ts,
 * edit.mutation.ts over insertCategory and updateCategoryIn) over the store.
 *
 * - The body is checked with the v1 route's own schema first (api-contract
 *   categories/schemas.ts: the name's length, controls and blank rule, the
 *   color, the icon, a uuid id, a PATCH that names a field and never `kind`),
 *   and a refusal is the schema's first issue, as the route answers it.
 * - The order after that is the server's: a taken id (IdTakenError, before
 *   anything about the name), then a category that is not there, then the
 *   version the caller read (CategoryChangedError), then a taken name.
 * - A name is taken by the domain's rule (category-name.ts: trim-exact, case
 *   counts) over every category the store holds. Run over an overlay (the
 *   device's booking) that is the pulled rows plus the device's own unsent
 *   creates and renames, whose names the overlay lays in (pending.ts). The
 *   server stays the authority: a name it holds that the device has not
 *   pulled parks at send.
 * - The id is the caller's (a uuid the device made); the version is a
 *   placeholder (category-version.ts) until the server's answer names one. A
 *   new category is version 0.
 * - `kind` is set here and never edited. A name is stored as typed.
 *
 * Run through LocalDb.write or LocalDb.preview. The undo of a create deletes
 * the row (refused while anything holds it, children.ts); the undo of an edit
 * puts the replaced fields back.
 */
import {
	createCategorySchema,
	patchCategorySchema,
} from "@retrospend/api-contract/categories";
import {
	CATEGORY_NAME_TAKEN_MESSAGE,
	sameCategoryName,
} from "@retrospend/domain/category-name";
import { CategoryChangedError } from "@retrospend/domain/category-version";
import { CATEGORY_NOT_FOUND } from "@retrospend/domain/expense-write/refusals";
import { IdTakenError } from "@retrospend/domain/id-taken";
import { withLocalCategoryVersion } from "./category-version";
import { NotFoundError } from "./errors";
import { SYNC_FIRST } from "./expense-write-local";
import type { WriteFn } from "./local-db";
import { type CategoryRow, InvalidInputError } from "./port";
import type { Repos } from "./repos";

export const CATEGORY_CREATE = "category.create";
export const CATEGORY_UPDATE = "category.update";

/** A create or a rename met a name the person already uses. */
export class CategoryNameTakenError extends InvalidInputError {
	constructor() {
		super(CATEGORY_NAME_TAKEN_MESSAGE);
	}
}

/**
 * The category the device holds has no version (a row an older build pulled,
 * before the server sent one): an edit would go out with no `expectedVersion`
 * and overwrite another device's change. Refused, never booked on a guess;
 * a pull brings the version.
 */
export class CategoryVersionUnknownError extends InvalidInputError {
	constructor() {
		super(SYNC_FIRST);
	}
}

/** A category's kind as the wire spells it. */
export type CategoryKindOnWire = "expense" | "income";

/** What a person fills in when they add a category: the v1 body's fields. */
export interface CreateCategoryInput {
	/** The category's client-made id (a uuid). */
	readonly id: string;
	readonly name: string;
	/** One of the contract's colors. */
	readonly color: string;
	readonly icon?: string;
	/** Expense when absent. Set here and never edited. */
	readonly kind?: CategoryKindOnWire;
	/** A new expense in it stays out of analytics; false when absent. */
	readonly excludeByDefault?: boolean;
}

/**
 * What an edit names: only the fields that change. `name` is sent only for a
 * rename (a name sent moves the version even when it is the same text), and
 * `icon: null` removes the icon. `kind` is here only so the refusal can be
 * held to the server's: a category's kind is set when it is made.
 */
export interface UpdateCategoryInput {
	readonly id: string;
	readonly name?: string;
	readonly color?: string;
	readonly icon?: string | null;
	readonly excludeByDefault?: boolean;
	/** The version the caller read; another version is CategoryChangedError. Not checked when absent. */
	readonly expectedVersion?: number;
	readonly kind?: CategoryKindOnWire;
}

/** The first issue of the route's schema is the refusal, as the route answers it. */
function refuseBadBody(
	schema: {
		safeParse(input: unknown):
			| { readonly success: true }
			| {
					readonly success: false;
					readonly error: { readonly issues: readonly { message: string }[] };
			  };
	},
	input: unknown,
) {
	const parsed = schema.safeParse(input);
	if (!parsed.success)
		throw new InvalidInputError(
			parsed.error.issues[0]?.message ?? "Invalid input",
		);
}

/** Whether another category already holds `name` (the domain's rule), the one named `exceptId` aside. */
export const nameTaken = (r: Repos, name: string, exceptId?: string): boolean =>
	r.categories
		.list()
		.some((c) => c.id !== exceptId && sameCategoryName(c.name, name));

export function createCategory(
	input: CreateCategoryInput,
): WriteFn<CategoryRow> {
	return (r) => {
		refuseBadBody(createCategorySchema, input);
		if (r.categories.get(input.id)) throw new IdTakenError();
		if (nameTaken(r, input.name)) throw new CategoryNameTakenError();
		const row: CategoryRow = {
			id: input.id,
			kind: input.kind === "income" ? "INCOME" : "EXPENSE",
			name: input.name,
			color: input.color,
			icon: input.icon ?? null,
			excludeByDefault: input.excludeByDefault ?? false,
			version: 0,
		};
		r.categories.insert(row);
		return row;
	};
}

/** Changes the fields named; the others stay. */
export function updateCategory(
	input: UpdateCategoryInput,
): WriteFn<CategoryRow> {
	return (r) => {
		refuseBadBody(patchCategorySchema, input);
		const before = r.categories.get(input.id);
		if (!before) throw new NotFoundError(CATEGORY_NOT_FOUND);
		if (!Number.isInteger(before.version))
			throw new CategoryVersionUnknownError();
		if (
			input.expectedVersion !== undefined &&
			input.expectedVersion !== before.version
		)
			throw new CategoryChangedError();
		const renamed = input.name !== undefined;
		if (input.name !== undefined && nameTaken(r, input.name, input.id))
			throw new CategoryNameTakenError();
		const next = withLocalCategoryVersion(
			before,
			{
				...before,
				...(input.name !== undefined && { name: input.name }),
				...(input.color !== undefined && { color: input.color }),
				...(input.icon !== undefined && { icon: input.icon }),
				...(input.excludeByDefault !== undefined && {
					excludeByDefault: input.excludeByDefault,
				}),
			},
			renamed,
		);
		r.categories.update(next);
		return next;
	};
}
