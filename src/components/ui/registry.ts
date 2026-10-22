/**
 * The primitive registry: every file in src/components/ui, its one job and
 * whether new code may import it. docs/ui/GUIDELINE.md §4 explains the jobs.
 *
 * - core: use it for its job, and only for that job.
 * - internal: a building block of another primitive. Import the primitive
 *   named in `use` instead (outside src/components/ui).
 * - legacy: being replaced. No new imports; the uiRules ratchet (UI-041)
 *   counts the old ones and the count can only go down.
 *
 * A new file in src/components/ui fails the registry test (UI-040) until it
 * has an entry here, and a new entry needs the owner's sign-off (R18).
 */

export type PrimitiveStatus = "core" | "internal" | "legacy";

export type Primitive = {
	/** File name without extension, as imported from `~/components/ui/<file>`. */
	file: string;
	status: PrimitiveStatus;
	/** The one job. */
	job: string;
	/** What to use instead (internal and legacy entries). */
	use?: string;
};

export const REGISTRY: Primitive[] = [
	{
		file: "accordion",
		status: "core",
		job: "Expand and collapse sections of long reference content (docs, FAQ)",
	},
	{
		file: "alert",
		status: "core",
		job: "Notice: one line that needs the person, with at most one action. At most one per page",
	},
	{
		file: "alert-dialog",
		status: "internal",
		job: "Radix building block of ConfirmationDialog",
		use: "confirmation-dialog",
	},
	{
		file: "avatar",
		status: "internal",
		job: "Radix avatar building block",
		use: "user-avatar",
	},
	{
		file: "avatar-stack",
		status: "core",
		job: "Faces of a set of people: overlaps, spreads on hover, name tooltip, +N (R20)",
	},
	{
		file: "badge",
		status: "core",
		job: "A status word from one status map (R5). Never decoration, never a count, never around money",
	},
	{
		file: "BrandIcon",
		status: "core",
		job: "Third-party brand mark (payment apps, banks)",
	},
	{
		file: "breadcrumb",
		status: "core",
		job: "Back path on pushed pages (person, project) on desktop",
	},
	{
		file: "button",
		status: "core",
		job: "Every action button: primary, secondary, ghost, danger; sizes ctl and ctl-sm",
	},
	{
		file: "calendar",
		status: "internal",
		job: "Day grid inside DatePicker",
		use: "date-picker",
	},
	{
		file: "card",
		status: "legacy",
		job: "Bordered box",
		use: "A flat section (heading + content + space). Borders only around objects you act on (R2)",
	},
	{
		file: "category-badge",
		status: "core",
		job: "Category identity in a list or table row (tinted tile allowed in rows only, R25 amended)",
	},
	{
		file: "chart",
		status: "core",
		job: "Chart container and tooltip; colors from series tokens only",
	},
	{
		file: "checkbox",
		status: "core",
		job: "Multi-select in tables and settings",
	},
	{
		file: "chip",
		status: "core",
		job: "Filter chip: text only, selected by fill (FilterChips, R7)",
	},
	{ file: "collapsible", status: "core", job: "Show more inside a section" },
	{
		file: "command",
		status: "core",
		job: "Command palette (Cmd+K) and type-to-filter menus",
	},
	{
		file: "confirmation-dialog",
		status: "core",
		job: "Confirm a destructive action: title with the object, one line, one specific button",
	},
	{
		file: "context-menu",
		status: "core",
		job: "Right-click menu on fine pointers; items come from the action registry (R8)",
	},
	{
		file: "crypto-icon",
		status: "core",
		job: "Crypto currency identity glyph",
	},
	{
		file: "currency-flag",
		status: "core",
		job: "Fiat currency identity (circle flag)",
	},
	{
		file: "date-picker",
		status: "core",
		job: "Pick a date or range, with presets",
	},
	{
		file: "dialog",
		status: "internal",
		job: "Radix dialog building block",
		use: "responsive-dialog (Sheet) or confirmation-dialog",
	},
	{
		file: "drawer",
		status: "internal",
		job: "Vaul drawer building block",
		use: "responsive-dialog (Sheet)",
	},
	{
		file: "dropdown-menu",
		status: "core",
		job: "Overflow menu and pickers; items come from the action registry (R8)",
	},
	{
		file: "empty-state",
		status: "core",
		job: "Nothing here: one line plus at most one action",
	},
	{
		file: "form",
		status: "core",
		job: "react-hook-form field wiring: label, control, hint, error",
	},
	{
		file: "image-crop-dialog",
		status: "core",
		job: "Crop an uploaded avatar or project cover",
	},
	{ file: "input", status: "core", job: "Text input at control height" },
	{ file: "input-otp", status: "core", job: "One-time code entry (2FA)" },
	{ file: "label", status: "core", job: "Field label" },
	{
		file: "payment-method-icon",
		status: "core",
		job: "Payment method identity (Venmo, PayPal, bank)",
	},
	{
		file: "popover",
		status: "core",
		job: "Anchored panel for a picker or a short form",
	},
	{
		file: "progress",
		status: "core",
		job: "Progress bar: accent on track, attention only when over",
	},
	{
		file: "rate-selector",
		status: "core",
		job: "Pick an exchange rate type (official, blue, card, MEP, custom)",
	},
	{
		file: "responsive-dialog",
		status: "core",
		job: "Sheet: dialog on desktop, bottom sheet on phone. One per task",
	},
	{
		file: "scroll-area",
		status: "core",
		job: "Scroll region with themed scrollbar",
	},
	{
		file: "segmented-toggle",
		status: "core",
		job: "Segmented: switch views of the same data in place (R7, R21)",
	},
	{
		file: "select",
		status: "core",
		job: "Pick one of a list at control height (no native select)",
	},
	{ file: "separator", status: "core", job: "Hairline between groups" },
	{
		file: "sheet",
		status: "internal",
		job: "Radix side sheet building block (sidebar on phone, Sheet on phone)",
		use: "responsive-dialog (Sheet)",
	},
	{
		file: "sidebar",
		status: "core",
		job: "Desktop sidebar: destinations, Tools, pinned projects, account",
	},
	{
		file: "skeleton",
		status: "core",
		job: "Loading placeholder in place of the content",
	},
	{ file: "slider", status: "core", job: "Pick a value on a range" },
	{
		file: "sonner",
		status: "core",
		job: "Toast: confirms a finished action and offers Undo (R15)",
	},
	{
		file: "stat-card",
		status: "legacy",
		job: "Metric tile",
		use: "One hero number plus a glance line or key-value rows (R3)",
	},
	{
		file: "switch",
		status: "core",
		job: "On/off setting that applies at once",
	},
	{
		file: "table",
		status: "core",
		job: "Desktop table: compare and sort records",
	},
	{
		file: "tabs",
		status: "core",
		job: "Underline tabs: switch sibling pages or whole panes (R21)",
	},
	{ file: "textarea", status: "core", job: "Multi-line text (notes)" },
	{
		file: "toggle",
		status: "legacy",
		job: "Pressed-state button",
		use: "segmented-toggle, switch or chip",
	},
	{
		file: "toggle-group",
		status: "legacy",
		job: "Second pick-one control",
		use: "segmented-toggle (R7: one pick-one control)",
	},
	{
		file: "tooltip",
		status: "core",
		job: "Name of an icon-only control or a face; one clause",
	},
	{
		file: "transaction-status-badge",
		status: "core",
		job: "Expense status atom (pending, settled) from one map (R5)",
	},
	{
		file: "unsaved-changes-dialog",
		status: "core",
		job: "Leave with unsaved changes?",
	},
	{
		file: "user-avatar",
		status: "core",
		job: "One person's face or initials on their avatar color",
	},
];
