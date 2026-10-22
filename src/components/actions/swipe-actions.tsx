"use client";

import * as React from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { ActionArea } from "./action-menu";
import { ACTIONS, type Entity } from "./registry";
import {
	isSwipe,
	restingOffset,
	type SwipeState,
	settleSwipe,
	swipeOffset,
} from "./swipe";
import {
	type ActionDef,
	type ActionHandlers,
	type ActionTarget,
	type SwipeSide,
	swipeEntries,
} from "./types";
import { type EntityActionProps, useEntityActions } from "./use-entity-actions";

type Props<E extends Entity> = EntityActionProps<E> & {
	children: React.ReactElement;
	/**
	 * Phone web keeps swipe off: it fights the browser's back gesture
	 * (GUIDELINE §6). Long press and the ⋯ menu always work. Turn it on only
	 * where no browser gesture competes.
	 */
	swipe?: boolean;
};

/**
 * SwipeActions: a phone row whose swipe uncovers actions from the entity's
 * registry. Every swipe action is also in the row's menu (its twin), which
 * long press opens through ActionArea.
 */
export function SwipeActions<E extends Entity>({
	children,
	swipe = false,
	...props
}: Props<E>) {
	if (!swipe) return <ActionArea {...props}>{children}</ActionArea>;
	return <SwipeRow {...props}>{children}</SwipeRow>;
}

function SwipeRow<E extends Entity>({
	children,
	...props
}: EntityActionProps<E> & { children: React.ReactElement }) {
	const actions = useEntityActions(props);
	const defs = ACTIONS[props.entity] as readonly ActionDef<ActionTarget>[];
	const side = (s: SwipeSide) =>
		swipeEntries(
			defs,
			props.target as ActionTarget,
			props.handlers as ActionHandlers<ActionTarget>,
			s,
		);
	const leadRef = React.useRef<HTMLDivElement>(null);
	const trailRef = React.useRef<HTMLDivElement>(null);
	const drag = React.useRef<{ x: number; y: number; on: boolean } | null>(null);
	const [state, setState] = React.useState<SwipeState>("closed");
	const [dx, setDx] = React.useState<number | null>(null);
	const widths = () =>
		[
			leadRef.current?.offsetWidth ?? 0,
			trailRef.current?.offsetWidth ?? 0,
		] as const;
	const [lead, trail] = widths();
	const offset = dx ?? restingOffset(state, lead, trail);

	const strip = (s: SwipeSide, ref: React.RefObject<HTMLDivElement | null>) => (
		<div
			className={cn(
				"absolute inset-y-0 flex",
				s === "lead" ? "left-0" : "right-0",
			)}
			ref={ref}
		>
			{side(s).map((a) => (
				<Button
					className="h-full rounded-none px-4"
					key={a.id}
					onClick={() => {
						setState("closed");
						actions.run(a);
					}}
					tabIndex={state === s ? 0 : -1}
					type="button"
					variant={a.danger ? "destructive" : "secondary"}
				>
					<a.icon aria-hidden="true" />
					{actions.label(a)}
				</Button>
			))}
		</div>
	);

	return (
		<div className="relative overflow-hidden">
			{strip("lead", leadRef)}
			{strip("trail", trailRef)}
			<div
				className={cn(
					"relative bg-surface",
					dx === null && "transition-transform duration-(--t-row) ease-land",
				)}
				onClickCapture={(e) => {
					// A tap on an open row closes it instead of opening the row.
					if (state === "closed") return;
					e.preventDefault();
					e.stopPropagation();
					setState("closed");
				}}
				onPointerCancel={() => {
					drag.current = null;
					setDx(null);
				}}
				onPointerDown={(e) => {
					if (e.pointerType === "mouse") return;
					drag.current = { x: e.clientX - offset, y: e.clientY, on: false };
				}}
				onPointerMove={(e) => {
					const d = drag.current;
					if (!d) return;
					const mx = e.clientX - d.x;
					if (!d.on && !isSwipe(mx - offset, e.clientY - d.y)) return;
					d.on = true;
					setDx(swipeOffset(mx, lead, trail));
				}}
				onPointerUp={() => {
					const d = drag.current;
					drag.current = null;
					if (!d?.on || dx === null) return;
					setState(settleSwipe(dx, lead, trail));
					setDx(null);
				}}
				style={{ transform: `translateX(${offset}px)` }}
			>
				<ActionArea {...props}>{children}</ActionArea>
			</div>
			{actions.confirm}
		</div>
	);
}
