import * as z from "zod";

// Apart from the ledger groups so a device validates a typed day without the
// route builder (see amount-text.ts).

/** A day with no time, in the caller's time zone. */
export const daySchema = z.iso.date().meta({ id: "Day" });
