import { getLocales } from "expo-localization";
import { createTranslator } from "use-intl";
import { loadMessages, resolveLocale } from "@/lib/i18n";
import { getLanguagePref } from "@/lib/language-pref";
import type { LocalNotification } from "./feed";
import { deepLinkFor, PUSH_CHANNELS, PUSH_KINDS, textKeyOf } from "./kinds";
import type { LocalChannel, LocalPost } from "./platform";

/** Looks a message up by its full key; the catalogs are read at run time. */
export type Translate = (key: string) => string;

/**
 * A translator for code that runs outside React (the background task): the
 * app language when one was chosen, else the phone's, with English filling
 * any gap.
 */
export function makeTranslator(): Translate {
	const pref = getLanguagePref();
	const locale = pref === "device" ? resolveLocale(getLocales()) : pref;
	const t = createTranslator({ locale, messages: loadMessages(locale) });
	return t as unknown as Translate;
}

/** The Android channels with names in the app's language. */
export function channelDefs(t: Translate): LocalChannel[] {
	return PUSH_CHANNELS.map((id) => ({
		id,
		name: t(`mobile.push.channel.${id}.name`),
		description: t(`mobile.push.channel.${id}.description`),
	}));
}

/**
 * What the phone shows for one notification. Same words as the server's
 * APNs text (push.json), made from the kind alone: the feed carries no
 * amount for a change someone else made, so the plain body is used.
 */
export function postFor(n: LocalNotification, t: Translate): LocalPost {
	const key = textKeyOf(n.kind, n.direction);
	return {
		key: n.key,
		channel: PUSH_KINDS[n.kind].channel,
		title: t(`push.${key}.title`),
		body: t(`push.${key}.body`),
		url: deepLinkFor(n.kind),
	};
}
