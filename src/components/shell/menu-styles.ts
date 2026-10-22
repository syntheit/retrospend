/**
 * The kit's menu (kit.css .menu) on today's DropdownMenu, which still has the
 * legacy look. The `!` beats the unlayered .glass-popover rule; glass belongs
 * to iOS chrome, not to web menus (R17). Drop these once S1b restyles the
 * dropdown primitive itself.
 */
export const MENU_CONTENT =
	"min-w-52 rounded-panel border-line bg-surface! p-1 text-fg shadow-menu backdrop-blur-none!";

export const MENU_ITEM =
	"h-ctl gap-2 rounded-ctl px-3 py-0 text-body text-fg focus:bg-raised focus:text-fg [&_svg:not([class*='text-'])]:text-fg-2";

export const MENU_SEPARATOR = "my-1 bg-line";

export const MENU_HINT = "ml-auto text-fg-3 text-meta tracking-normal";
