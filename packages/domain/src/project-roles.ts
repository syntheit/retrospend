/**
 * Project roles and what they allow, as plain rules: the server and a device
 * read the same ones, so the edit affordance on a row never differs between
 * them. The write path (assertCanModifyTransaction) is the authority these
 * mirror.
 */

export const ROLE_RANK: Record<string, number> = {
	VIEWER: 0,
	CONTRIBUTOR: 1,
	EDITOR: 2,
	ORGANIZER: 3,
};

/**
 * `projectId -> highest role` from membership rows of the caller (one row per
 * alias identity): when several aliases are members of one project the
 * highest-ranked role wins.
 */
export function strongestRoles(
	memberships: Iterable<{ projectId: string; role: string }>,
): Map<string, string> {
	const roleMap = new Map<string, string>();
	for (const m of memberships) {
		const existing = roleMap.get(m.projectId);
		if (
			existing === undefined ||
			(ROLE_RANK[m.role] ?? -1) > (ROLE_RANK[existing] ?? -1)
		) {
			roleMap.set(m.projectId, m.role);
		}
	}
	return roleMap;
}

/**
 * The read-side edit/delete permission for a single transaction from a
 * caller-role map:
 *
 * - Locked (settled) transactions: never editable.
 * - Project-scoped: ORGANIZER/EDITOR may edit any expense; CONTRIBUTOR only
 *   their own; VIEWER / non-members none.
 * - Standalone (no project): only the creator.
 *
 * `isCreator` must already account for the caller's claim aliases.
 */
export function deriveCanModify(args: {
	isLocked: boolean;
	projectId: string | null;
	isCreator: boolean;
	roleMap: ReadonlyMap<string, string>;
}): boolean {
	const { isLocked, projectId, isCreator, roleMap } = args;
	if (isLocked) return false;
	if (projectId) {
		const role = roleMap.get(projectId);
		return (
			role === "ORGANIZER" ||
			role === "EDITOR" ||
			(role === "CONTRIBUTOR" && isCreator)
		);
	}
	return isCreator;
}
