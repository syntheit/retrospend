import {
	type MessageCatalog,
	mergeMessageCatalogs,
} from "@retrospend/i18n/catalog";
import { loadCatalog } from "@retrospend/i18n/load";
import { createTranslator } from "next-intl";
import { DEFAULT_LOCALE } from "~/i18n/locales";

/**
 * Words a message for a person who is not in a request, such as a push or a
 * notification written for someone else: one feature namespace of the
 * catalog, in their language, with English where a locale has no value.
 */

export type ServerTranslate = {
	(key: string, values?: Record<string, string>): string;
	has(key: string): boolean;
};

const namespaces = new Map<string, MessageCatalog>();

async function namespaceOf(
	locale: string,
	namespace: string,
): Promise<MessageCatalog> {
	const id = `${locale}:${namespace}`;
	const known = namespaces.get(id);
	if (known) return known;
	const english = await loadCatalog(DEFAULT_LOCALE);
	const merged =
		locale === DEFAULT_LOCALE
			? english
			: mergeMessageCatalogs(english, await loadCatalog(locale));
	const messages = { [namespace]: merged[namespace] as MessageCatalog };
	namespaces.set(id, messages);
	return messages;
}

/** The catalog is read at run time, so its keys are not in the types. */
export async function serverTranslator(
	locale: string,
	namespace: string,
): Promise<ServerTranslate> {
	// A missing message throws instead of returning its own key, so raw
	// "namespace.key" text can never reach a push, notification or email.
	return createTranslator({
		locale,
		messages: await namespaceOf(locale, namespace),
		namespace,
		onError: (error) => {
			throw error;
		},
		getMessageFallback: ({ namespace: ns, key }) => {
			throw new Error(`Missing message ${ns}.${key} for ${locale}`);
		},
	}) as unknown as ServerTranslate;
}
