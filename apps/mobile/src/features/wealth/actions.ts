import type { MenuIcon } from "@/ui/menuIcons";
import type { SwipeAction } from "@/ui/SwipeRow";
import type { MenuItem } from "@/ui/types";
import type { Account } from "./source";

/**
 * What can be done to an account, in one place: the row's swipes and its
 * long-press menu, and the account page's overflow all read it, so each
 * action is reachable without a swipe (a screen reader, a keyboard). It is
 * the mockup's registry: an open account updates, edits, closes or is deleted;
 * a closed one reopens or is deleted.
 */
export type AccountAction = "update" | "edit" | "reopen" | "close" | "delete";

type Target = Pick<Account, "closedAt">;

/** What a row is given: its long-press menu and its two swipes. */
export interface AccountRowActions {
	menu: MenuItem[];
	leading: SwipeAction;
	trailing: SwipeAction;
}

/** The mark each action leads with in a menu. */
export const ACCOUNT_ICON = {
	update: undefined,
	edit: "Pencil",
	reopen: "ArchiveRestore",
	close: "Archive",
	delete: "Trash2",
} as const satisfies Record<AccountAction, MenuIcon | undefined>;

/** The actions of an account's menu, in order. */
export function actionsOf(account: Target): AccountAction[] {
	return account.closedAt === null
		? ["update", "edit", "close", "delete"]
		: ["reopen", "delete"];
}

/** The one action each swipe direction does. */
export function swipesOf(account: Target): {
	leading: AccountAction;
	trailing: AccountAction;
} {
	return account.closedAt === null
		? { leading: "update", trailing: "close" }
		: { leading: "reopen", trailing: "delete" };
}
