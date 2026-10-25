/**
 * The stand-ins a deleted person leaves on the shared records. A deleted
 * user and a deleted guest become one shared sentinel. A deleted ghost
 * (shadow profile) becomes its own, because two ghosts must never collapse
 * into one party: one ghost's debt and another's credit would cancel in the
 * balances of the people who remain.
 */
export const DELETED_USER_SENTINEL = "DELETED_USER";
export const DELETED_USER_NAME = "Deleted User";

export const DELETED_GUEST_SENTINEL = "DELETED_GUEST";
export const DELETED_GUEST_NAME = "Deleted Guest";

export const DELETED_SHADOW_SENTINEL = "DELETED_SHADOW";
export const DELETED_SHADOW_NAME = "Deleted Participant";

/** The sentinel of one deleted ghost: the prefix, an underscore, the ghost's id. */
export const deletedShadowSentinel = (shadowId: string) =>
	`${DELETED_SHADOW_SENTINEL}_${shadowId}`;

/** Whether an id is a deleted ghost's sentinel (the old shared one included). */
export const isDeletedShadow = (id: string) =>
	id.startsWith(DELETED_SHADOW_SENTINEL);
