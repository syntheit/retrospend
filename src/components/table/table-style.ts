import { TABLE_CELLS } from "~/components/ui/table";

/**
 * The design's table look (GUIDELINE §6, kit `.table`) laid over the shared
 * DataTable engine without forking it: the cell look of `ui/table`'s panel
 * plus the hairline on the engine's own bordered panel (`[&>div>div]`).
 * A plain `ui/table` takes the same look with `<Table look="panel">`.
 */
export const TABLE_LOOK = `${TABLE_CELLS} [&>div>div]:border-line`;

/** A right-aligned money column (R27): every amount on one edge. */
export const MONEY_CELL = "text-right";
