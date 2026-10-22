// Loads a locale's messages through import.meta.glob, which Turbopack (next
// dev and build) and Vite (vitest) expand at build time. A new feature file
// is picked up without editing any list. Metro does not support
// import.meta.glob, so the mobile app loads catalogs its own way and shares
// only ./catalog.
import { assembleCatalog, type MessageCatalog } from "./catalog";

const SHARED = import.meta.glob<MessageCatalog>("../messages/*.json", {
	import: "default",
});
const FEATURES = import.meta.glob<MessageCatalog>("../messages/*/*.json", {
	import: "default",
});
const FEATURE_PATH = /^\.\.\/messages\/([^/]+)\/([^/]+)\.json$/;

/** One locale's messages (shared plus feature files), with no fallback. */
export async function loadCatalog(locale: string): Promise<MessageCatalog> {
	const loadShared = SHARED[`../messages/${locale}.json`];
	if (!loadShared) throw new Error(`No message catalog for locale ${locale}`);

	const features: Record<string, MessageCatalog> = {};
	for (const [path, load] of Object.entries(FEATURES)) {
		const [, fileLocale, namespace] = FEATURE_PATH.exec(path) ?? [];
		if (fileLocale === locale && namespace) features[namespace] = await load();
	}

	return assembleCatalog(await loadShared(), features);
}
