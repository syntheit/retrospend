import { menuOf } from "@/ui/actionRegistry";
import { rowActions } from "./activity/rowActions";
import { actionsOf as accountActions } from "./wealth/actions";
import { CURRENCY_ACTIONS, currencyActionsOf } from "./currencies/currencyActions";
import { PERSON_ACTIONS, personActionsOf } from "./people/personActions";
import {
	PROJECT_ACTIONS,
	projectActionsOf,
	startOf,
} from "./projects/projectActions";
import {
	RECURRING_ACTIONS,
	recurringActionsOf,
} from "./recurring/recurringActions";
import {
	CATEGORY_ACTIONS,
	categoryActionsOf,
} from "./settings/categories/categoryActions";
import { METHOD_ACTIONS, methodActionsOf } from "./settings/payment/methodActions";

const noop = () => undefined;
const words = (ids: readonly string[]) =>
	Object.fromEntries(ids.map((id) => [id, id]));
const runs = (ids: readonly string[]) =>
	Object.fromEntries(ids.map((id) => [id, noop]));
// Build the menu a row gets and check Delete or Remove is last when present.
function menu<Id extends string>(
	ids: Id[],
	defs: Record<Id, { id: Id; icon?: never; destructive?: boolean }>,
) {
	return menuOf(
		ids,
		defs as never,
		words(ids) as never,
		runs(ids) as never,
	);
}

describe("person registry", () => {
	it("leads with the page's buttons, then the exports", () => {
		expect(
			personActionsOf({ nothingShared: false, owesYou: true, canAdd: true }),
		).toEqual([
			"settle",
			"remind",
			"expense",
			"export-history",
			"share-statement",
		]);
	});
	it("leaves out what does not apply", () => {
		expect(
			personActionsOf({ nothingShared: true, owesYou: false, canAdd: false }),
		).toEqual(["export-history", "share-statement"]);
		expect(Object.keys(PERSON_ACTIONS)).toHaveLength(5);
	});
});

describe("project registry", () => {
	it("gives an organizer every action, Delete last", () => {
		const ids = projectActionsOf({ status: "ACTIVE", myRole: "ORGANIZER" });
		expect(ids).toEqual([
			"add-person",
			"share-project",
			"project-settings",
			"archive-project",
			"delete-project",
		]);
		const items = menu(ids, PROJECT_ACTIONS as never);
		expect(items.at(-1)?.id).toBe("delete-project");
		expect(items.at(-1)?.destructive).toBe(true);
	});
	it("restores an archived project instead of archiving it", () => {
		expect(projectActionsOf({ status: "ARCHIVED", myRole: "ORGANIZER" })).toEqual(
			[
				"add-person",
				"share-project",
				"project-settings",
				"restore-project",
				"delete-project",
			],
		);
	});
	it("gives a viewer nothing", () => {
		expect(projectActionsOf({ status: "ACTIVE", myRole: null })).toEqual([]);
	});
	it("names a sheet from a route only when it is one", () => {
		expect(startOf("delete")).toBe("delete");
		expect(startOf("nope")).toBeUndefined();
	});
});

describe("payment method registry", () => {
	it("offers Make primary only to a method that is not first, Remove last", () => {
		expect(methodActionsOf({ rank: 2 })).toEqual(["edit", "prefer", "remove"]);
		expect(methodActionsOf({ rank: 1 })).toEqual(["edit", "remove"]);
		expect(METHOD_ACTIONS.remove.destructive).toBe(true);
	});
});

describe("recurring registry", () => {
	it("confirms and skips what is due, Delete last either way", () => {
		expect(recurringActionsOf(true)).toEqual([
			"confirm",
			"skip",
			"details",
			"delete",
		]);
		expect(recurringActionsOf(false)).toEqual(["details", "delete"]);
		expect(RECURRING_ACTIONS.delete.destructive).toBe(true);
	});
});

describe("currency registry", () => {
	it("stars only a currency with a rate and has no history for crypto", () => {
		expect(
			currencyActionsOf({ favorite: false, rateId: null, crypto: false }),
		).toEqual(["convert", "history"]);
		expect(
			currencyActionsOf({ favorite: false, rateId: "r", crypto: true }),
		).toEqual(["convert", "favorite"]);
		expect(Object.keys(CURRENCY_ACTIONS)).toHaveLength(3);
	});
});

describe("category registry", () => {
	it("renames, recolors and toggles counting, with nothing destructive", () => {
		expect(categoryActionsOf()).toEqual(["rename", "icon", "count"]);
		expect(
			Object.values(CATEGORY_ACTIONS).some((a) => a.destructive),
		).toBe(false);
	});
});

describe("account registry", () => {
	it("deletes last for an open and a closed account", () => {
		expect(accountActions({ closedAt: null }).at(-1)).toBe("delete");
		expect(accountActions({ closedAt: "2026-01-01" as never }).at(-1)).toBe(
			"delete",
		);
	});
});

describe("activity registry", () => {
	const words = {
		select: "Select",
		edit: "Edit",
		categorize: "Categorize",
		delete: "Delete",
	};
	const on = {
		select: noop,
		edit: noop,
		categorize: noop,
		remove: noop,
	};
	it("gives a pending row Edit and Delete only, Delete last", () => {
		const { menu: items } = rowActions(
			{ unsynced: true, canEdit: true } as never,
			words,
			on,
			true,
		);
		expect(items.map((i) => i.id)).toEqual(["edit", "delete"]);
		expect(items.at(-1)?.destructive).toBe(true);
	});
	it("gives a pending row only Delete when it cannot be edited", () => {
		const { menu: items } = rowActions(
			{ unsynced: true, canEdit: false } as never,
			words,
			on,
			true,
		);
		expect(items.map((i) => i.id)).toEqual(["delete"]);
	});
});
