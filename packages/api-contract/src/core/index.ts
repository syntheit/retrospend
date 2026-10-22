import * as z from "zod";

/**
 * Small schemas the G1 core groups (settings, profile, categories,
 * currencies, search, notifications, push, tokens) share. Kept apart from
 * common/ so the platform conventions stay owned by one stream.
 */

/** A row id in a path (`/categories/{id}`). Ids are cuids or UUIDs. */
export const idSchema = z.string().min(1).max(64);

export const idParamsSchema = z.object({ id: idSchema });

/** An instant on the wire: ISO 8601 with an offset (the server sends Z). */
export const timestampSchema = z.iso.datetime({ offset: true });

/** An exact decimal as text, so no float ever carries it ("1450.25"). */
export const decimalStringSchema = z
	.string()
	.regex(/^-?\d+(\.\d+)?$/)
	.meta({ id: "DecimalString", examples: ["1450.25"] });

/** What a delete or a bulk write answers when there is nothing else to say. */
export const okSchema = z.object({ ok: z.literal(true) });

/**
 * The app's languages. Mirrors SUPPORTED_LOCALES in src/i18n/locales.ts; a
 * test on the server side keeps the two equal.
 */
export const LANGUAGES = [
	"en",
	"es",
	"es-AR",
	"ru",
	"pt-BR",
	"fr",
	"de",
] as const;

export const languageSchema = z.enum(LANGUAGES).meta({ id: "Language" });
