import { useEffect, useRef } from "react";
import { AppState, Linking } from "react-native";
import { RetrospendSurfaces } from "../../modules/surfaces";
import { routeForUrl } from "./links";
import { type ComposerPrefill, parsePending } from "./prefill";

type Open = (mode: ComposerPrefill["mode"], prefill: ComposerPrefill) => void;

// The link that started this app process, so a remount of the tabs does not
// open the composer a second time.
let handledInitial: string | null = null;

/**
 * Opens the composer for what the system surfaces send: a retrospend://add
 * link (Quick Settings tile, a Control, a Shortcut), or a share or Shortcut
 * waiting in the native hand-off (taken when the app starts, comes to the
 * front, or Android reports a new share).
 */
export function useSurfaceLinks(open: Open) {
	const openRef = useRef(open);
	openRef.current = open;

	useEffect(() => {
		const drain = () => {
			const prefill = parsePending(RetrospendSurfaces?.consumePending() ?? null);
			if (prefill) openRef.current(prefill.mode, prefill);
		};
		const handle = (url: string) => {
			const link = routeForUrl(url);
			if (link?.kind === "compose") {
				openRef.current(link.prefill.mode, link.prefill);
			} else if (link?.kind === "pending") {
				drain();
			}
		};
		Linking.getInitialURL().then((url) => {
			if (url && url !== handledInitial) {
				handledInitial = url;
				handle(url);
			}
		});
		drain();
		const link = Linking.addEventListener("url", ({ url }) => handle(url));
		const state = AppState.addEventListener("change", (next) => {
			if (next === "active") drain();
		});
		const share = RetrospendSurfaces?.addListener("onPending", drain);
		return () => {
			link.remove();
			state.remove();
			share?.remove();
		};
	}, []);
}
