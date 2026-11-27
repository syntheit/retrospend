/**
 * Whether this server takes what a phone queues for an account or a transfer
 * (contract 1.16.0): client-made ids on every account and transfer write
 * (1.15.0), `expectedVersion` and `expectedBalance` (1.14.0), and the ids a
 * PUT answers. Told to apps as features.wealthWrites. A phone books these
 * writes on the device only when it says true: an older server ignores the
 * ids it does not know and would answer with rows of its own. The one owner,
 * beside AUTO_CONFIRM.
 */
export const WEALTH_WRITES = true;
