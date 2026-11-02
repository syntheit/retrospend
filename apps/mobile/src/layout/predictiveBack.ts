import { useRootNavigationState } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { useTheme } from "@/theme";
import { useHasBackConsumer } from "./backConsumers";
import { RetrospendPredictiveBack } from "../../modules/predictive-back";

/** The part of a navigation state this file reads (a React Navigation state). */
interface NavState {
	type?: string;
	index?: number;
	routes?: { state?: NavState }[];
	history?: unknown[];
}

/**
 * Whether the system back would pop a pushed screen right now: true when the
 * deepest stack on the focus path has a screen to pop, false when system back
 * would first switch tabs (the tab bar's history) or when nothing is left to
 * pop. Only a pop gets the back preview; a tab switch and the app's root keep
 * what the system does.
 */
export function backPopsAScreen(state: NavState | undefined): boolean {
	return walk(state) === true;
}

function walk(state: NavState | undefined): boolean | undefined {
	if (!state?.routes) return undefined;
	const focused = state.routes[state.index ?? 0];
	const inner = walk(focused?.state);
	if (inner !== undefined) return inner;
	if (state.type === "stack" && (state.index ?? 0) > 0) return true;
	if (state.type === "tab" && (state.history?.length ?? 0) > 1) return false;
	return undefined;
}

/**
 * Turns the native back preview on while a pushed screen can be popped. The
 * native side exists only on Android 16 and up (below that the module does
 * nothing), so back stays exactly what it was on older Android and on iOS.
 */
export function usePredictiveBack(): void {
	const state = useRootNavigationState();
	// An open search takes Back first: nothing pops, so there is no preview.
	const consumed = useHasBackConsumer();
	const pops =
		Platform.OS === "android" && !consumed && backPopsAScreen(state as NavState);
	// The shrinking screen reveals the raised tone around itself.
	const backdrop = useTheme().color.raised;
	useEffect(() => {
		if (!RetrospendPredictiveBack) return;
		RetrospendPredictiveBack.setEnabled(pops, backdrop);
	}, [pops, backdrop]);
}
