import { formatMoney } from "@retrospend/domain/format";
import {
	type NumberFormatChoice,
	withNumberFormat,
} from "@retrospend/domain/format-locale";
import { type Money, toMinor } from "@retrospend/domain/money-minor";
import { DEFAULT_LOCALE, matchSupportedLocale } from "~/i18n/locales";
import { serverTranslator } from "~/server/services/server-translator";

/**
 * The one place the text of an in-app notification or a notification email
 * is made. It takes a kind, the name of the person who did it and amounts,
 * and nothing a person typed: no expense title, project name, period label
 * or note (end-to-end encryption rule 3). A reader who wants the detail
 * opens the thing by the ids in the notification's `data`, so the server
 * could word the same notice for data it cannot read.
 *
 * The person named is a display name, which is account-level or shared
 * data. Amounts are Money and go through the shared money formatter, in the
 * reader's language and number format.
 */

export type NoticeKind =
	| "expenseSplit"
	| "expenseEdited"
	| "expenseDeleted"
	| "paymentRecordedByPayee"
	| "settlementReceived"
	| "settlementConfirmed"
	| "settlementRejected"
	| "settlementReminder"
	| "balanceReminder"
	| "squaredUp"
	| "periodClosed"
	| "addedToProject"
	| "ownershipTransferred"
	| "profileClaimed"
	| "fixRequested"
	| "fixAccepted"
	| "fixDeclined"
	| "splitCorrected"
	| "projectInvite"
	| "guestResume";

/** An amount the text names, and the shape of the payment behind it. */
export interface NoticeAmount {
	money: Money;
	/** More than one: the payment spans that many currencies, in `money`'s. */
	currencies?: number;
	/** An offset against what the other person owes you, with no money moved. */
	offset?: boolean;
}

export interface Notice {
	kind: NoticeKind;
	/** The display name of who did it; null reads as "Someone". */
	actor?: string | null;
	amount?: NoticeAmount | null;
	/** The whole amount, when `amount` is a share of it. */
	total?: Money | null;
	/** The email carries a link, so the text may say what it leads to. */
	hasLink?: boolean;
}

export interface NoticeReader {
	language?: string | null;
	numberFormat?: NumberFormatChoice | null;
}

export interface NoticeText {
	title: string;
	body: string;
	/** The label of an email's button, for the kinds that have one. */
	cta: string | null;
}

/**
 * Money from a stored amount (a Prisma Decimal, string or number), or null
 * when it cannot be read exactly in the currency. A notice then names no
 * amount; it never names a wrong one.
 */
export function noticeMoney(amount: unknown, currency: string): Money | null {
	if (amount === null || amount === undefined) return null;
	try {
		return {
			minor: toMinor(
				typeof amount === "number" ? amount : String(amount),
				currency,
			),
			currency: currency.trim().toUpperCase(),
		};
	} catch {
		return null;
	}
}

/** The text of one notice, for the person it goes to. */
export async function buildNoticeText(
	notice: Notice,
	reader: NoticeReader = {},
): Promise<NoticeText> {
	const locale = matchSupportedLocale(reader.language) ?? DEFAULT_LOCALE;
	const t = await serverTranslator(locale, "notificationText");
	const format = (money: Money) =>
		formatMoney(money, {
			locale: withNumberFormat(locale, reader.numberFormat ?? null),
			display: "code",
		});
	const key = notice.kind;
	const values: Record<string, string> = {
		actor: notice.actor?.trim() || t("actorUnknown"),
	};
	let body = `${key}.body`;
	const amount = notice.amount;
	if (amount) {
		values.amount = format(amount.money);
		const variant = amount.offset
			? "bodyOffset"
			: (amount.currencies ?? 1) > 1
				? "bodyAcross"
				: notice.total
					? "bodyWithTotal"
					: "bodyWithAmount";
		if (variant === "bodyAcross") values.count = String(amount.currencies);
		if (variant === "bodyWithTotal" && notice.total)
			values.total = format(notice.total);
		if (t.has(`${key}.${variant}`)) body = `${key}.${variant}`;
		else if (variant === "bodyWithTotal" && t.has(`${key}.bodyWithAmount`))
			body = `${key}.bodyWithAmount`;
	}
	if (notice.hasLink && t.has(`${key}.bodyWithLink`))
		body = `${key}.bodyWithLink`;
	return {
		title: t(`${key}.title`),
		body: t(body, values),
		cta: t.has(`${key}.cta`) ? t(`${key}.cta`) : null,
	};
}
