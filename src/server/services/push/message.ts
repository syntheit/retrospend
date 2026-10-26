import { EVENT_ID_PATTERN } from "@retrospend/api-contract";
import { formatMoney } from "@retrospend/domain/format";
import type { Money } from "@retrospend/domain/money-minor";
import {
	type MessageCatalog,
	mergeMessageCatalogs,
} from "@retrospend/i18n/catalog";
import { loadCatalog } from "@retrospend/i18n/load";
import { createTranslator } from "next-intl";
import { DEFAULT_LOCALE, matchSupportedLocale } from "~/i18n/locales";
import {
	PUSH_KINDS,
	type PushChannel,
	type PushKind,
	pushKindOf,
} from "./kinds";
import type { PushMessage } from "./senders/types";

/**
 * The one place push text is made. A notification is built from a kind, ids
 * and an amount, and from nothing a person typed: no title, note or name
 * (end-to-end encryption rule 3), so the server could build it even for
 * data it cannot read. The same module makes the machine part the app
 * reads (`PushData`), which carries ids and Money only.
 */

export type PushData = {
	v: 1;
	/** The event type (`payment.recorded`) or `recurring.due`. */
	type: PushKind;
	channel: PushChannel;
	/** What the push is about, so the app can open it. */
	entity: { type: string; id: string } | null;
	/** Other ids the app may need, by name. */
	ids: Record<string, string>;
	/** The figure the text names, when it has one. */
	amount: Money | null;
	/** Recurring items only: money out (an expense) or in (income). */
	direction?: "in" | "out";
};

/** How long a push service may hold a push for an offline device. */
export const PUSH_TTL_SECONDS = 24 * 60 * 60;

const KEYS: Record<Exclude<PushKind, "recurring.due">, string> = {
	"shared_expense.created": "sharedExpenseCreated",
	"shared_expense.updated": "sharedExpenseUpdated",
	"fix_request.created": "fixRequestCreated",
	"payment.recorded": "paymentRecorded",
	"payment.confirmed": "paymentConfirmed",
	"payment.not_received": "paymentNotReceived",
	"payment.reminded": "paymentReminded",
};

export function newPushData(
	type: PushKind,
	parts: {
		entity?: PushData["entity"];
		ids?: PushData["ids"];
		amount?: Money | null;
		direction?: PushData["direction"];
	} = {},
): PushData {
	return {
		v: 1,
		type,
		channel: PUSH_KINDS[type].channel,
		entity: parts.entity ?? null,
		ids: parts.ids ?? {},
		amount: parts.amount ?? null,
		...(parts.direction && { direction: parts.direction }),
	};
}

const isId = (v: unknown): v is string =>
	typeof v === "string" && EVENT_ID_PATTERN.test(v);

/** The payload column read back; null when it is not what this module wrote. */
export function parsePushData(value: unknown): PushData | null {
	if (typeof value !== "object" || value === null) return null;
	const v = value as Partial<PushData>;
	const kind = typeof v.type === "string" ? pushKindOf(v.type) : null;
	if (v.v !== 1 || !kind) return null;
	const entity =
		v.entity && isId(v.entity.id) && typeof v.entity.type === "string"
			? { type: v.entity.type, id: v.entity.id }
			: null;
	const ids = Object.fromEntries(
		Object.entries(v.ids ?? {}).filter(([, id]) => isId(id)),
	);
	const amount =
		v.amount &&
		Number.isSafeInteger(v.amount.minor) &&
		typeof v.amount.currency === "string"
			? { minor: v.amount.minor, currency: v.amount.currency }
			: null;
	return newPushData(kind, {
		entity,
		ids,
		amount,
		direction:
			v.direction === "in" || v.direction === "out" ? v.direction : undefined,
	});
}

type Translate = {
	(key: string, values?: Record<string, string>): string;
	has(key: string): boolean;
};

const pushCatalogs = new Map<string, MessageCatalog>();

async function catalogFor(locale: string): Promise<MessageCatalog> {
	const known = pushCatalogs.get(locale);
	if (known) return known;
	const english = await loadCatalog(DEFAULT_LOCALE);
	const merged =
		locale === DEFAULT_LOCALE
			? english
			: mergeMessageCatalogs(english, await loadCatalog(locale));
	const messages = { push: merged.push as MessageCatalog };
	pushCatalogs.set(locale, messages);
	return messages;
}

/** The text of one push, in the language of the person it goes to. */
export async function buildPushMessage(
	data: PushData,
	language: string | null | undefined,
): Promise<PushMessage> {
	const locale = matchSupportedLocale(language) ?? DEFAULT_LOCALE;
	// The catalog is read at run time, so its keys are not in the types.
	const t = createTranslator({
		locale,
		messages: await catalogFor(locale),
		namespace: "push",
	}) as unknown as Translate;
	const key =
		data.type === "recurring.due"
			? data.direction === "in"
				? "recurringDueIn"
				: "recurringDueOut"
			: KEYS[data.type];
	const amount = data.amount
		? formatMoney(data.amount, { locale, display: "code" })
		: null;
	return {
		title: t(`${key}.title`),
		body:
			amount && t.has(`${key}.bodyWithAmount`)
				? t(`${key}.bodyWithAmount`, { amount })
				: t(`${key}.body`),
		channel: data.channel,
		data,
		ttlSeconds: PUSH_TTL_SECONDS,
	};
}
