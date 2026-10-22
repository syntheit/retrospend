/**
 * The design's table look (GUIDELINE §6, kit `.table`) laid over the shared
 * DataTable engine without forking it: a surface panel with a hairline, a
 * 36px header in 12px fg-3, rows at row height with hairlines, raised on
 * hover and brand-soft when selected. Descendant selectors win over the
 * engine's legacy cell classes, so DataTable and ui/table stay untouched
 * until the switch-over restyles them.
 */
export const TABLE_LOOK = [
	"rounded-panel bg-surface text-body text-fg",
	"[&>div>div]:border-line",
	"[&_th]:h-9 [&_th]:border-line [&_th]:border-b [&_th]:bg-surface [&_th]:px-3 [&_th]:py-0 [&_th]:font-medium [&_th]:text-fg-3 [&_th]:text-meta",
	"[&_th:hover]:bg-surface",
	"[&_td]:h-row [&_td]:px-3 [&_td]:py-0",
	"[&_tbody_tr]:border-line",
	"can-hover:[&_tbody_tr:hover]:bg-raised",
	"[&_tbody_tr[data-state=selected]]:bg-brand-soft",
	"[&_tfoot_td]:h-11 [&_tfoot_td]:border-line-strong [&_tfoot_td]:border-t [&_tfoot_td]:bg-surface [&_tfoot_td]:px-3 [&_tfoot_td]:font-semibold",
].join(" ");

/** A right-aligned money column (R27): every amount on one edge. */
export const MONEY_CELL = "text-right";
