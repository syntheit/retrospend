import type { Locale } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import { es } from "date-fns/locale/es";
import { fr } from "date-fns/locale/fr";
import { ptBR } from "date-fns/locale/pt-BR";
import { ru } from "date-fns/locale/ru";

const DATE_LOCALE_MAP: Record<string, Locale> = {
	en: enUS,
	es: es,
	"es-AR": es,
	fr,
	"pt-BR": ptBR,
	ru,
};

/**
 * Returns the date-fns Locale object for the given app locale string.
 * Falls back to en-US when the locale is not mapped.
 */
export function getDateFnsLocale(locale: string): Locale {
	return DATE_LOCALE_MAP[locale] ?? enUS;
}
