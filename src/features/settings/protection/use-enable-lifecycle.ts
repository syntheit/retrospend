// The enable sheet's lifecycle (enable-lifecycle.ts) tied to React: the
// controller is made once, and two effects tell it when the sheet closes and
// when it unmounts.
import { useEffect, useRef } from "react";
import {
	createEnableLifecycle,
	type EnableLifecycle,
	type LifecyclePorts,
} from "./enable-lifecycle";

export function useEnableLifecycle({
	open,
	reset,
}: LifecyclePorts & { open: boolean }): EnableLifecycle {
	// The latest callback, so the effects below run on `open` and unmount only.
	const latest = useRef({ reset });
	latest.current = { reset };
	const life = useRef<EnableLifecycle | null>(null);
	life.current ??= createEnableLifecycle({
		reset: () => latest.current.reset(),
	});
	const controller = life.current;

	useEffect(() => {
		if (!open) controller.closed();
	}, [open, controller]);
	useEffect(() => () => controller.unmounted(), [controller]);
	return controller;
}
