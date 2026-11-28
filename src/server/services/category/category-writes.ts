/**
 * Whether this server takes what a phone queues for a category (contract
 * 1.18.0): a client-made id on create (a taken one is 409 id_taken),
 * `expectedVersion` on PATCH (409 category_changed), and the undo tokens of
 * both. Told to apps as features.categoryWrites. A phone books these writes on
 * the device only when it says true: an older server ignores an id it does not
 * know and would answer with a row of its own. The one owner, beside
 * WEALTH_WRITES and AUTO_CONFIRM.
 */
export const CATEGORY_WRITES = true;
