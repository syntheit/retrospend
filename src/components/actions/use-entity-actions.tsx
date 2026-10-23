"use client";

import { useTranslations } from "next-intl";
import * as React from "react";

import { ConfirmationDialog } from "~/components/ui/confirmation-dialog";
import { ACTIONS, type Entity, type EntityTargets } from "./registry";
import {
	type ActionDef,
	type ActionHandlers,
	type ActionTarget,
	actionForKey,
	isRowKey,
	type MenuEntry,
	menuEntries,
} from "./types";

export type EntityActionProps<E extends Entity> = {
	entity: E;
	target: EntityTargets[E];
	/** One handler per action id; actions without one are not shown. */
	handlers: ActionHandlers<EntityTargets[E]>;
};

/**
 * Everything the menu, right-click, long press and swipe share for one
 * target: the entries, their labels, the row letter keys, and the confirm
 * step that every destructive action takes (a named button, never just OK).
 */
export function useEntityActions<E extends Entity>(
	props: EntityActionProps<E>,
) {
	// One entity per call, so its defs, target and handlers always match;
	// past this line they are handled as the shared ActionTarget shape.
	type T = ActionTarget;
	const entity: string = props.entity;
	const target = props.target as T;
	const handlers = props.handlers as ActionHandlers<T>;
	const t = useTranslations("entityActions");
	const defs = ACTIONS[props.entity] as readonly ActionDef<T>[];
	const [pending, setPending] = React.useState<ActionDef<T> | null>(null);

	const entries: MenuEntry<T>[] = React.useMemo(
		() => menuEntries(defs, target, handlers),
		[defs, target, handlers],
	);

	const label = React.useCallback(
		(a: ActionDef<T>) => t(`${entity}.${a.id}.label`),
		[t, entity],
	);

	const run = React.useCallback(
		(a: ActionDef<T>) => {
			if (a.danger && (a.safety ?? "confirm") === "confirm") {
				setPending(a);
				return;
			}
			void handlers[a.id]?.(target);
		},
		[handlers, target],
	);

	const onRowKeyDown = React.useCallback(
		(e: React.KeyboardEvent) => {
			if (!isRowKey(e)) return;
			const a = actionForKey(defs, target, handlers, e);
			if (!a) return;
			e.preventDefault();
			run(a);
		},
		[defs, target, handlers, run],
	);

	const confirm = pending ? (
		<ConfirmationDialog
			confirmLabel={t(`${entity}.${pending.id}.confirmButton`)}
			description={t(`${entity}.${pending.id}.confirmBody`)}
			onConfirm={() => {
				const a = pending;
				setPending(null);
				void handlers[a.id]?.(target);
			}}
			onOpenChange={(open) => {
				if (!open) setPending(null);
			}}
			open
			title={t(`${entity}.${pending.id}.confirmTitle`, { name: target.name })}
			variant="destructive"
		/>
	) : null;

	return { entries, label, run, onRowKeyDown, confirm };
}
