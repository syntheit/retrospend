/**
 * A typed exchange rate on the wire: the decimal text the user typed (after
 * the locale reader, features/entry/rate-text.ts), never a float, so no
 * digit is lost before the server books it. Its bounds are the homeRate
 * column's, DECIMAL(28,12): up to 16 digits before the point and 12 after.
 */
import { z } from "zod";

export const customRateSchema = z
	.string()
	.regex(/^\d{1,16}(\.\d{1,12})?$/, "Enter a rate like 1.0834")
	.refine((v) => /[1-9]/.test(v), "Enter a rate above 0");
