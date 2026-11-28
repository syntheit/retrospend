/**
 * Vectors for the category writes (create and edit). Every expected value is
 * derived by hand in the comment above it, from the rules the server runs
 * (category/create.mutation.ts, edit.mutation.ts, category.service.ts) and
 * the domain's:
 *
 * - A new category is version 0, and `kind` is set there and never edited.
 *   An edit moves the version by 1 when it names `name` (a rename counts even
 *   with the same text: the service never compares) or when color, icon or
 *   excludeByDefault changes value, and by 1 only once when it does both. A
 *   write that changes nothing moves nothing. (CATEGORY_VERSION_COLUMNS; the
 *   engine's number is a placeholder and the vectors hold the server to the
 *   same count.)
 * - Two names are the same name when they are equal after trimming both ends
 *   (category-name.ts): "Food" and "Food " are one name, "Food" and "food"
 *   are two, and a name of only spaces is no name. A name is stored as typed.
 * - The order of refusals is the server's: the body's schema (its first issue),
 *   a taken id, a category that is not there, the version the caller read,
 *   then a taken name.
 * - ARS home, blue 1 USD = 1,545 ARS (official 1,050), zone Buenos Aires.
 *   An expense in a category made with excludeByDefault true stays out of
 *   spending; one made later, after the toggle, counts. The `spent` figure is
 *   by the currency spent (USD 10.00 is minor 1000); the home amount is
 *   USD 10.00 x 1,545 = ARS 15,450.00.
 *
 * The expected rows are compared by value.
 */
import {
	ARS,
	type CategoryVector,
	NOV10,
	type SeedCategory,
	uuid,
} from "./category-vector-types";
import { CATEGORY_NAME_TAKEN_MESSAGE } from "@retrospend/domain/category-name";
import { CATEGORY_CHANGED_MESSAGE } from "@retrospend/domain/category-version";
import { CATEGORY_NOT_FOUND } from "@retrospend/domain/expense-write/refusals";
import { ID_TAKEN_MESSAGE } from "@retrospend/domain/id-taken";

const refused = (refusedWith: string) => ({ refused: refusedWith });

/** The words of the route's schemas (api-contract categories/schemas.ts, common/user-text.ts). */
const NAME_REQUIRED = "Category name is required";
const NO_CONTROLS = "Text cannot contain control characters";
const KIND_FIXED = "A category's kind cannot be changed";
const NAME_A_FIELD = "Name at least one field to change";
const BAD_UUID = "Invalid UUID";

const [FOOD, BILLS, GIFTS] = [uuid(20), uuid(21), uuid(22)];

const seeded = (
	id: string,
	name: string,
	over: Partial<SeedCategory> = {},
): SeedCategory => ({
	id,
	name,
	color: "teal",
	kind: "EXPENSE",
	...over,
});

const make = (id: string, over: Record<string, unknown> = {}) =>
	({
		kind: "categoryCreate",
		body: { id, name: "Food", color: "teal", ...over },
	}) as const;

const edit = (id: string, over: Record<string, unknown> = {}) =>
	({ kind: "categoryUpdate", body: { id, ...over } }) as const;

const food = (over: Record<string, unknown> = {}) => ({
	name: "Food",
	color: "teal",
	icon: null,
	kind: "EXPENSE" as const,
	excludeByDefault: false,
	version: 0,
	...over,
});

export const categoryVectors: CategoryVector[] = [
	{
		// Food in teal: an expense category, no icon, count default off, version
		// 0. Pay in emerald with the banknote icon, kind income and the default
		// on: every field of the body lands as typed, still version 0.
		name: "a category is made at version 0 with every field it was given",
		seed: ARS,
		steps: [
			{
				now: NOV10,
				op: make(FOOD),
				expect: {
					done: { categories: { [FOOD]: food() }, categoryCount: 1 },
				},
			},
			{
				now: NOV10,
				op: make(BILLS, {
					name: "Pay",
					color: "emerald",
					icon: "banknote",
					kind: "income",
					excludeByDefault: true,
				}),
				expect: {
					done: {
						categories: {
							[BILLS]: food({
								name: "Pay",
								color: "emerald",
								icon: "banknote",
								kind: "INCOME",
								excludeByDefault: true,
							}),
						},
						categoryCount: 2,
					},
				},
			},
		],
	},
	{
		// Food at version 0. Color to blue: 1. Icon to utensils: 2. Count default
		// on: 3. Icon removed (null): 4, the value changed. Rename to Groceries:
		// 5, stored as typed. The same color again: still 5, nothing changed.
		// A name sent that is the stored text: 6, a rename counts. Rename and
		// color together (Market, red): 7, once. Count default off and icon cart
		// without a name: 8, once.
		name: "each field of an edit moves the version once, and a no-change moves nothing",
		seed: ARS,
		categories: [seeded(FOOD, "Food")],
		steps: [
			{
				now: NOV10,
				op: edit(FOOD, { color: "blue" }),
				expect: {
					done: { categories: { [FOOD]: food({ color: "blue", version: 1 }) } },
				},
			},
			{
				now: NOV10,
				op: edit(FOOD, { icon: "utensils" }),
				expect: {
					done: {
						categories: {
							[FOOD]: food({ color: "blue", icon: "utensils", version: 2 }),
						},
					},
				},
			},
			{
				now: NOV10,
				op: edit(FOOD, { excludeByDefault: true }),
				expect: {
					done: {
						categories: {
							[FOOD]: food({
								color: "blue",
								icon: "utensils",
								excludeByDefault: true,
								version: 3,
							}),
						},
					},
				},
			},
			{
				now: NOV10,
				op: edit(FOOD, { icon: null }),
				expect: {
					done: {
						categories: {
							[FOOD]: food({
								color: "blue",
								excludeByDefault: true,
								version: 4,
							}),
						},
					},
				},
			},
			{
				now: NOV10,
				op: edit(FOOD, { name: "Groceries" }),
				expect: {
					done: {
						categories: {
							[FOOD]: food({
								name: "Groceries",
								color: "blue",
								excludeByDefault: true,
								version: 5,
							}),
						},
					},
				},
			},
			{
				now: NOV10,
				op: edit(FOOD, { color: "blue" }),
				expect: {
					done: {
						categories: {
							[FOOD]: food({
								name: "Groceries",
								color: "blue",
								excludeByDefault: true,
								version: 5,
							}),
						},
					},
				},
			},
			{
				now: NOV10,
				op: edit(FOOD, { name: "Groceries" }),
				expect: {
					done: {
						categories: {
							[FOOD]: food({
								name: "Groceries",
								color: "blue",
								excludeByDefault: true,
								version: 6,
							}),
						},
					},
				},
			},
			{
				now: NOV10,
				op: edit(FOOD, { name: "Market", color: "red" }),
				expect: {
					done: {
						categories: {
							[FOOD]: food({
								name: "Market",
								color: "red",
								excludeByDefault: true,
								version: 7,
							}),
						},
					},
				},
			},
			{
				now: NOV10,
				op: edit(FOOD, { excludeByDefault: false, icon: "cart" }),
				expect: {
					done: {
						categories: {
							[FOOD]: food({
								name: "Market",
								color: "red",
								icon: "cart",
								version: 8,
							}),
						},
					},
				},
			},
		],
	},
	{
		// Food and Bills (at version 3) exist. "food" differs only by case: a
		// third name, made. "Food " and " Food" equal Food once trimmed: refused,
		// as is renaming Bills to "Food ". Three spaces are no name; a bell
		// character is not text. Food renamed to "Food " (itself, one more
		// space) is no clash: stored as typed, version 1. Bills renamed with a
		// stale version (2 against 3) is refused as changed, not as a taken
		// name: the version is read first. With 3 it is renamed (4).
		name: "a name is taken after trimming and never by case, and an edit's order is the server's",
		seed: ARS,
		categories: [seeded(FOOD, "Food"), seeded(BILLS, "Bills", { version: 3 })],
		steps: [
			{
				now: NOV10,
				op: make(GIFTS, { name: "food" }),
				expect: {
					done: {
						categories: { [GIFTS]: food({ name: "food" }) },
						categoryCount: 3,
					},
				},
			},
			{
				now: NOV10,
				op: make(uuid(30), { name: "Food " }),
				expect: refused(CATEGORY_NAME_TAKEN_MESSAGE),
			},
			{
				now: NOV10,
				op: make(uuid(31), { name: " Food" }),
				expect: refused(CATEGORY_NAME_TAKEN_MESSAGE),
			},
			{
				now: NOV10,
				op: make(uuid(32), { name: "   " }),
				expect: refused(NAME_REQUIRED),
			},
			{
				now: NOV10,
				op: make(uuid(33), { name: "Fo\u0007od" }),
				expect: refused(NO_CONTROLS),
			},
			{
				now: NOV10,
				op: edit(BILLS, { name: "Food " }),
				expect: refused(CATEGORY_NAME_TAKEN_MESSAGE),
			},
			{
				now: NOV10,
				op: edit(FOOD, { name: "Food " }),
				expect: {
					done: {
						categories: { [FOOD]: food({ name: "Food ", version: 1 }) },
						categoryCount: 3,
					},
				},
			},
			{
				now: NOV10,
				op: edit(BILLS, { name: "Food", expectedVersion: 2 }),
				expect: refused(CATEGORY_CHANGED_MESSAGE),
			},
			{
				now: NOV10,
				op: edit(BILLS, { name: "Bills 2", expectedVersion: 3 }),
				expect: {
					done: {
						categories: { [BILLS]: food({ name: "Bills 2", version: 4 }) },
					},
				},
			},
		],
	},
	{
		// A taken id is refused whatever the name (a taken name too: the id is read first); an id that is not a uuid is the
		// schema's; an edit of a category that is not there is "not found"; an
		// edit that names kind (even with a color) or names nothing is the
		// schema's; with the version read (0) a color edit lands (1), and the
		// same version again is stale.
		name: "ids, a kind, an empty edit and a stale version are refused in the route's words",
		seed: ARS,
		categories: [seeded(FOOD, "Food")],
		steps: [
			{
				// The id is read before the name: an id taken and a name taken is id taken.
				now: NOV10,
				op: make(FOOD, { name: "Food" }),
				expect: refused(ID_TAKEN_MESSAGE),
			},
			{
				now: NOV10,
				op: make(FOOD, { name: "Other" }),
				expect: refused(ID_TAKEN_MESSAGE),
			},
			{
				now: NOV10,
				op: make("not-a-uuid", { name: "Other" }),
				expect: refused(BAD_UUID),
			},
			{
				now: NOV10,
				op: edit(uuid(99), { color: "blue" }),
				expect: refused(CATEGORY_NOT_FOUND),
			},
			{
				now: NOV10,
				op: edit(FOOD, { kind: "income", color: "blue" }),
				expect: refused(KIND_FIXED),
			},
			{
				now: NOV10,
				op: edit(FOOD),
				expect: refused(NAME_A_FIELD),
			},
			{
				now: NOV10,
				op: edit(FOOD, { color: "blue", expectedVersion: 0 }),
				expect: {
					done: {
						categories: { [FOOD]: food({ color: "blue", version: 1 }) },
						categoryCount: 1,
					},
				},
			},
			{
				now: NOV10,
				op: edit(FOOD, { color: "red", expectedVersion: 0 }),
				expect: refused(CATEGORY_CHANGED_MESSAGE),
			},
		],
	},
	{
		// Gifts is made with the count default on. USD 20.00 filed under it at
		// blue: ARS 30,900.00 (20 x 1,545), excluded from analytics, so spending
		// stays empty. The default turned off (version 1) changes no row: the gift is
		// still excluded. USD 10.00 filed under it now: ARS 15,450.00, counted,
		// spent USD 10.00 (1000 minor). Only the new row follows the new default.
		name: "a new expense takes its category's count default and a toggle moves no old row",
		seed: ARS,
		steps: [
			{
				now: NOV10,
				op: make(GIFTS, { name: "Gifts", excludeByDefault: true }),
				expect: {
					done: {
						categories: {
							[GIFTS]: food({ name: "Gifts", excludeByDefault: true }),
						},
					},
				},
			},
			{
				now: NOV10,
				op: {
					kind: "create",
					body: {
						id: uuid(40),
						title: "Gift",
						amount: "20",
						currency: "USD",
						date: "2026-11-10",
						categoryId: GIFTS,
					},
				},
				expect: {
					done: {
						expenses: {
							[uuid(40)]: {
								categoryId: GIFTS,
								categoryKind: "EXPENSE",
								excludeFromAnalytics: true,
								currency: "USD",
								amount: "20",
								homeAmount: "30900",
							},
						},
						spent: [],
					},
				},
			},
			{
				now: NOV10,
				op: edit(GIFTS, { excludeByDefault: false }),
				expect: {
					done: {
						categories: { [GIFTS]: food({ name: "Gifts", version: 1 }) },
						expenses: {
							[uuid(40)]: {
								categoryId: GIFTS,
								categoryKind: "EXPENSE",
								excludeFromAnalytics: true,
								currency: "USD",
								amount: "20",
								homeAmount: "30900",
							},
						},
						spent: [],
					},
				},
			},
			{
				now: NOV10,
				op: {
					kind: "create",
					body: {
						id: uuid(41),
						title: "Card",
						amount: "10",
						currency: "USD",
						date: "2026-11-10",
						categoryId: GIFTS,
					},
				},
				expect: {
					done: {
						expenses: {
							[uuid(41)]: {
								categoryId: GIFTS,
								categoryKind: "EXPENSE",
								excludeFromAnalytics: false,
								currency: "USD",
								amount: "10",
								homeAmount: "15450",
							},
						},
						spent: [{ currency: "USD", minor: 1000 }],
					},
				},
			},
		],
	},
];
