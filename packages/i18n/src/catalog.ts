export type MessageCatalog = {
	[key: string]: MessageCatalog | string;
};

function isMessageCatalog(value: unknown): value is MessageCatalog {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Applies localized messages over the English source catalog without mutating
 * either input. Missing localized leaves keep their English value.
 */
export function mergeMessageCatalogs(
	fallback: MessageCatalog,
	localized: MessageCatalog,
): MessageCatalog {
	const merged: MessageCatalog = { ...fallback };

	for (const [key, localizedValue] of Object.entries(localized)) {
		const fallbackValue = fallback[key];

		merged[key] =
			isMessageCatalog(fallbackValue) && isMessageCatalog(localizedValue)
				? mergeMessageCatalogs(fallbackValue, localizedValue)
				: localizedValue;
	}

	return merged;
}

/**
 * One locale's catalog: the shared file (messages/<locale>.json) plus each
 * feature file (messages/<locale>/<feature>.json) under a namespace named
 * after the file. Features own their keys this way, so parallel work never
 * edits the same catalog. A namespace may exist only once.
 */
export function assembleCatalog(
	shared: MessageCatalog,
	features: Record<string, MessageCatalog>,
): MessageCatalog {
	const catalog: MessageCatalog = { ...shared };

	for (const [namespace, messages] of Object.entries(features)) {
		if (namespace in catalog) {
			throw new Error(
				`Message namespace "${namespace}" is in the shared catalog and in ${namespace}.json`,
			);
		}
		catalog[namespace] = messages;
	}

	return catalog;
}
