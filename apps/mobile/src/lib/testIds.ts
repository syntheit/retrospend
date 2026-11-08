// Stable ids for the Maestro flows (docs/roadmap/maestro-plan.md 2.1). Maestro
// finds a control by `testID`; the flows may only use ids from this file, and
// the app imports them from here, so a rename breaks the checks, not a
// nightly run.
//
// Convention: "<screen>.<element>", list rows "<screen>.row.<entityId>"
// (rowId). Never visible text, never an index.

export const TEST_IDS = {
	connect: {
		address: "connect.address",
		submit: "connect.submit",
		continue: "connect.continue",
	},
	signIn: {
		email: "signIn.email",
		password: "signIn.password",
		submit: "signIn.submit",
	},
	home: { total: "home.total" },
	add: {
		open: "add.open",
		title: "add.title",
		amount: "add.amount",
		save: "add.save",
	},
	toast: { message: "toast.message", undo: "toast.undo" },
	sheet: {
		close: "sheet.close",
		done: "sheet.done",
		edit: "sheet.edit",
		back: "sheet.back",
		/** The pinned primary action a form hands up (Save). */
		primary: "sheet.primary",
	},
} as const;

/** The id of a list row: `rowId("activity", expense.id)` is "activity.row.<id>". */
export function rowId(screen: string, entityId: string): string {
	return `${screen}.row.${entityId}`;
}

/** The id of a composer keypad key: `keyId("5")` is "keypad.key.5", `keyId("delete")` the Delete key. */
export function keyId(key: string): string {
	return `keypad.key.${key}`;
}
