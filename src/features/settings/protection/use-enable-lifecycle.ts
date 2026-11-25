// The enable sheet's lifecycle (packages/crypto/src/client/enable-lifecycle.ts) tied to React: the
// controller is made once, and two effects tell it when the sheet closes and
// when it unmounts. The recovery and Make new key sheets use it too, with
// their own drafts.
import {
	createEnableLifecycle,
	type EnableLifecycle,
	type KeyDraft,
	type LifecyclePorts,
} from "@retrospend/crypto/client";
import { useEffect, useRef } from "react";

export function useEnableLifecycle<D extends { wipe: () => void } = KeyDraft>({
	open,
	reset,
}: LifecyclePorts & { open: boolean }): EnableLifecycle<D> {
	// The latest callback, so the effects below run on `open` and unmount only.
	const latest = useRef({ reset });
	latest.current = { reset };
	const life = useRef<EnableLifecycle<D> | null>(null);
	life.current ??= createEnableLifecycle<D>({
		reset: () => latest.current.reset(),
	});
	const controller = life.current;

	useEffect(() => {
		if (!open) controller.closed();
	}, [open, controller]);
	useEffect(() => () => controller.unmounted(), [controller]);
	return controller;
}
