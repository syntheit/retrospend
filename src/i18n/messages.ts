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
