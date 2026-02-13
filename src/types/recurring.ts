import type { RouterOutputs } from "~/trpc/react";

export type RecurringTransaction = RouterOutputs["recurring"]["list"][number];
export type RecurringTemplate = RecurringTransaction;
