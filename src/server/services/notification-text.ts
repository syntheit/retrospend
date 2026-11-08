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

/**
 * What an edit changed, by kind: the amount before and after, and which
 * other parts changed. No title, note or name of anything, so a reader gets
 * "what changed" and opens the expense by id for the rest.
 */
export interface NoticeChanges {
	amount?: { from: Money; to: Money };
	date?: boolean;
	payer?: boolean;
	split?: boolean;
	category?: boolean;
	project?: boolean;
	/** Anything else: a title, note or receipt, which are never named. */
	other?: boolean;
}

/**
 * The ids and codes a notification carries so an app can open it. Closed on
 * purpose: a name, title or any text has no field here, and createNotification
 * drops any key that is not listed (NOTICE_DATA_KEYS).
 */
export interface NoticeData {
	transactionId?: string | null;
	settlementId?: string | null;
	settlementIds?: string[];
	paymentGroupId?: string | null;
	projectId?: string | null;
	periodId?: string | null;
	shadowId?: string | null;
	guestSessionId?: string | null;
	fixRequestId?: string | null;
	correctionIds?: string[];
	kind?: string;
	actorType?: string;
	actorId?: string;
	fromParticipantType?: string;
	fromParticipantId?: string;
	toParticipantType?: string;
	toParticipantId?: string;
}

export const NOTICE_DATA_KEYS: ReadonlySet<string> = new Set<keyof NoticeData>([
	"transactionId",
	"settlementId",
	"settlementIds",
	"paymentGroupId",
	"projectId",
	"periodId",
	"shadowId",
	"guestSessionId",
	"fixRequestId",
	"correctionIds",
	"kind",
	"actorType",
	"actorId",
	"fromParticipantType",
	"fromParticipantId",
	"toParticipantType",
	"toParticipantId",
]);

export interface Notice {
	kind: NoticeKind;
	/** The display name of who did it; null reads as "Someone". */
	actor?: string | null;
	amount?: NoticeAmount | null;
	/** The whole amount, when `amount` is a share of it. */
	total?: Money | null;
	/** The email carries a link, so the text may say what it leads to. */
	hasLink?: boolean;
	/** For an edit: what changed, worded as one line in `changes`. */
	changes?: NoticeChanges | null;
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
	/** "amount: ARS 1,000 to ARS 1,500, payer changed", or null. */
	changes: string | null;
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

/**
 * What an edit changed, from the names of the fields that changed and the
 * amount before and after. A field it does not know counts as `other`.
 */
export function noticeChanges(
	changed: readonly string[],
	before: { amount: unknown; currency: string },
	after: { amount: unknown; currency: string },
): NoticeChanges {
	const out: NoticeChanges = {};
	for (const field of changed) {
		if (field === "amount" || field === "currency") {
			const from = noticeMoney(before.amount, before.currency);
			const to = noticeMoney(after.amount, after.currency);
			if (from && to) out.amount = { from, to };
			else out.other = true;
		} else if (field === "date") out.date = true;
		else if (field === "paidBy") out.payer = true;
		else if (field === "splitMode" || field === "splitParticipants")
			out.split = true;
		else if (field === "categoryId") out.category = true;
		else if (field === "projectId") out.project = true;
		else out.other = true;
	}
	return out;
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
	const parts: string[] = [];
	const changes = notice.changes;
	if (changes?.amount)
		parts.push(
			t("changes.amount", {
				from: format(changes.amount.from),
				to: format(changes.amount.to),
			}),
		);
	for (const part of [
		"date",
		"payer",
		"split",
		"category",
		"project",
		"other",
	] as const)
		if (changes?.[part]) parts.push(t(`changes.${part}`));
	return {
		title: t(`${key}.title`),
		body: t(body, values),
		cta: t.has(`${key}.cta`) ? t(`${key}.cta`) : null,
		changes: parts.length > 0 ? parts.join(", ") : null,
	};
}
