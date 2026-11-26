import * as z from "zod";
import { amountTextSchema } from "../common/amount-text";
import { daySchema } from "../common/day";
import { currencyCodeSchema } from "../common/money";
import { userText } from "../common/user-text";

// The input rules of a recurring template's own fields, apart from the
// route builder so a device validates with the very schemas v1 does (one
// owner, AGENTS 6.8). The v1 create and update bodies are made from these
// fields; the engine's template writes parse with the two object schemas.

/**
 * How the wire says a template's direction, amount mode and pause, and what
 * the stored row calls them: the one owner, read by v1's create and update
 * and by the device's template writes. A field left out stays undefined, so
 * the domain's own defaults apply.
 */
const DIRECTION = { out: "OUT", in: "IN" } as const;
const AMOUNT_MODE = { fixed: "FIXED", ask: "ASK" } as const;
export type WireDirection = keyof typeof DIRECTION;
export type WireAmountMode = keyof typeof AMOUNT_MODE;

export const directionOfWire = (wire: WireDirection | undefined) =>
	wire && DIRECTION[wire];
export const amountModeOfWire = (wire: WireAmountMode | undefined) =>
	wire && AMOUNT_MODE[wire];
/** `paused` on the wire is `isActive` false on the row. */
export const isActiveOfWire = (paused: boolean | undefined) =>
	paused === undefined ? undefined : !paused;

export const templateName = userText("recurring.name", 191);
export const templateAmount = amountTextSchema;
export const templateCurrency = currencyCodeSchema;
export const templateDueDay = daySchema;
export const templateWebsiteUrl = userText("recurring.websiteUrl", 512);
export const templatePaymentSource = userText("recurring.paymentSource", 191);

/** What a create must hold, exactly as v1 checks it. */
export const templateCreateFieldsSchema = z.object({
	name: templateName,
	amount: templateAmount,
	currency: templateCurrency,
	nextDueDate: templateDueDay,
	websiteUrl: templateWebsiteUrl.optional(),
	paymentSource: templatePaymentSource.optional(),
});

/** What an edit may name, exactly as v1 checks it: a text field set to null is cleared. */
export const templateEditFieldsSchema = z.object({
	name: templateName.optional(),
	amount: templateAmount.optional(),
	currency: templateCurrency.optional(),
	nextDueDate: templateDueDay.optional(),
	websiteUrl: templateWebsiteUrl.nullable().optional(),
	paymentSource: templatePaymentSource.nullable().optional(),
});
