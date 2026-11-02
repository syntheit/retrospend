import type { MenuIcon } from "./menuIcons";
import type { MenuItem } from "./types";

/** One action of an entity: its id, the mark it leads with, and whether it is destructive. */
export interface ActionDef<Id extends string = string> {
	id: Id;
	icon?: MenuIcon;
	destructive?: boolean;
}

/**
 * A menu from a registry: the entity's action ids in order, the words for
 * them and what each does. A row's long-press menu, its swipes and the detail
 * screen's overflow all build from the same ids through here, so they cannot
 * drift. Destructive items go last, in their order (Delete closes the menu).
 */
export function menuOf<Id extends string>(
	ids: readonly Id[],
	defs: Record<Id, ActionDef<Id>>,
	words: Record<Id, string>,
	run: Record<Id, () => void>,
): MenuItem[] {
	const items = ids.map((id): MenuItem => {
		const def = defs[id];
		return {
			id,
			label: words[id],
			onPress: run[id],
			...(def.icon ? { icon: def.icon } : {}),
			...(def.destructive ? { destructive: true } : {}),
		};
	});
	return [
		...items.filter((item) => !item.destructive),
		...items.filter((item) => item.destructive),
	];
}
