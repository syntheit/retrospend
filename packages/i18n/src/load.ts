// Loads a locale's messages through import.meta.glob, which Turbopack (next
// dev and build) and Vite (vitest) expand at build time. A new feature file
// is picked up without editing any list. Metro does not support
// import.meta.glob, so the mobile app loads catalogs its own way and shares
// only ./catalog.
import {
	assembleCatalog,
	assembleNamespace,
	type MessageCatalog,
} from "./catalog";

const SHARED = import.meta.glob<MessageCatalog>("../messages/*.json", {
	import: "default",
});
const FEATURES = import.meta.glob<MessageCatalog>("../messages/*/*.json", {
	import: "default",
});
const FEATURE_PATH = /^\.\.\/messages\/([^/]+)\/([^/]+)\.json$/;

/**
 * The locale of every shared and feature file. loadCatalog only reads the
 * locale it is asked for, so a misnamed folder (es_AR/) would otherwise be
 * skipped without a word; the i18n check compares this list with the app's.
 */
export function catalogLocales(): string[] {
	return [...Object.keys(SHARED), ...Object.keys(FEATURES)].map(
		(path) => /^\.\.\/messages\/([^/.]+)/.exec(path)?.[1] ?? path,
	);
}

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

/**
 * One namespace of one locale's messages, with no fallback: the feature file
 * named after it, or the key of the shared file. Reads one file instead of
 * every feature file, for code that words a few messages (a push, an email).
 */
export async function loadNamespace(
	locale: string,
	namespace: string,
): Promise<MessageCatalog> {
	const loadShared = SHARED[`../messages/${locale}.json`];
	if (!loadShared) throw new Error(`No message catalog for locale ${locale}`);

	const loadFeature = FEATURES[`../messages/${locale}/${namespace}.json`];
	return assembleNamespace(
		await loadShared(),
		namespace,
		loadFeature && (await loadFeature()),
	);
}
