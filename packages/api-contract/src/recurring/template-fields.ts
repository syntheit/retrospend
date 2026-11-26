import * as z from "zod";
import { amountTextSchema } from "../common/amount-text";
import { daySchema } from "../common/day";
import { currencyCodeSchema } from "../common/money";
import { userText } from "../common/user-text";

// The input rules of a recurring template's own fields, apart from the
// route builder so a device validates with the very schemas v1 does (one
// owner, AGENTS 6.8). The v1 create and update bodies are made from these
// fields; the engine's template writes parse with the two object schemas.

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
