/**
 * The undo of Match categories' created categories, all or nothing: every
 * one is checked first, and none is removed while any holds expenses (the
 * import committed since). Only then each is removed, still with the
 * server's refuse-if-used rule, which covers the moment between the count and
 * the write. A refusal throws, so the toast says the undo failed and the
 * choices stay as they are.
 */
export async function undoCreated(
	ids: readonly string[],
	ops: {
		/** How many expenses the category holds now (the server's dry run of its delete). */
		expenseCount: (id: string) => Promise<number>;
		remove: (id: string) => Promise<unknown>;
	},
): Promise<void> {
	for (const id of ids)
		if ((await ops.expenseCount(id)) > 0)
			throw new Error("A created category holds expenses");
	for (const id of ids) await ops.remove(id);
}
