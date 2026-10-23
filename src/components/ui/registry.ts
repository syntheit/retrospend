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
 *
 * PLANNED lists the PLAN §6 components that live outside src/components/ui:
 * their job, what they replace and their target (IMPLEMENTATION §1.3).
 * `planned` ones do not exist yet: build them there, not as a local
 * lookalike. `built` ones exist at their target: import them from there.
 * Every name in PLAN_COMPONENTS is either a
 * core file (its `plan` field) or a planned entry; the registry test checks it.
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
	/** PLAN §6 components this core file is today (see PLAN_COMPONENTS). */
	plan?: string[];
};

export const REGISTRY: Primitive[] = [
	{
		file: "accordion",
		status: "core",
		job: "Expand and collapse sections of long reference content (docs, FAQ)",
	},
	{
		file: "alert",
		status: "legacy",
		job: "Old bordered alert on today's pages; new code uses notice",
		use: "notice",
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
		file: "avatar-face",
		status: "core",
		job: "Face: one person's picture or initials on their avatar color (mod 8, sizes 22 to 48); FaceStack: a set of people, payer first, spreads on hover, +N (R20)",
	},
	{
		file: "avatar-stack",
		status: "legacy",
		job: "Old faces stack on today's split rows; new code uses FaceStack from avatar-face",
		use: "avatar-face (FaceStack)",
	},
	{
		file: "badge",
		status: "core",
		job: "A status kind from the one status map as a pill (`status` prop, R5). Never decoration, never a count, never around money",
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
		job: "Every action button: `kind` primary, secondary, ghost, danger; sizes ctl and sm; icon-only and loading",
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
		job: "Category identity in a list or table row: CategoryTile, the tinted tile with its glyph (rows only, R25 amended); CategoryBadge is the old name pill on today's pages",
	},
	{
		file: "chart",
		status: "core",
		plan: ["Chart"],
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
		plan: ["FilterChips"],
		job: "FilterChip (text only, selected by fill), FilterChips row and the Filter menu (R7, R25)",
	},
	{ file: "collapsible", status: "core", job: "Show more inside a section" },
	{
		file: "command",
		status: "core",
		plan: ["Palette"],
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
		job: "Today's date field for the pages that already use it. New code uses DatePicker or DateRange from src/components/pickers",
	},
	{
		file: "dialog",
		status: "internal",
		job: "Radix dialog building block",
		use: "sheet (Sheet) or confirmation-dialog",
	},
	{
		file: "drawer",
		status: "internal",
		job: "Vaul drawer building block",
		use: "sheet (Sheet)",
	},
	{
		file: "dropdown-menu",
		status: "core",
		job: "Overflow menu and pickers; items come from the action registry (R8)",
	},
	{
		file: "edge-panel",
		status: "legacy",
		job: "Radix dialog drawn as an edge panel: the phone bottom sheet inside ResponsiveDialog and the sidebar's phone panel",
		use: "sheet (Sheet)",
	},
	{
		file: "empty-state",
		status: "core",
		plan: ["EmptyState"],
		job: "Nothing here (Empty): one line plus at most one action",
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
		file: "notice",
		status: "core",
		plan: ["Notice"],
		job: "Notice: one line that needs the person, with at most one action. At most one per page",
	},
	{
		file: "page-tabs",
		status: "core",
		job: "Underline tabs between sibling pages of one destination: real links, aria-current, sliding indicator (R21, R24)",
	},
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
		status: "legacy",
		job: "The old task dialog (dialog on desktop, bottom sheet on phone), kept for the pages that already use it",
		use: "sheet (Sheet)",
	},
	{
		file: "scroll-area",
		status: "core",
		job: "Scroll region with themed scrollbar",
	},
	{
		file: "segmented",
		status: "core",
		plan: ["Segmented"],
		job: "Segmented: switch views of the same data in place, 2 to 4 options (R7, R21)",
	},
	{
		file: "segmented-toggle",
		status: "legacy",
		job: "Old pill toggle on today's pages; new code uses segmented",
		use: "segmented",
	},
	{
		file: "select",
		status: "core",
		job: "Pick one of a list at control height (no native select)",
	},
	{ file: "separator", status: "core", job: "Hairline between groups" },
	{
		file: "sheet",
		status: "core",
		plan: ["Sheet"],
		job: "Sheet: one task that finishes in place. Dialog on desktop, medium and large detent sheet on phone; focus return, Cmd+Enter, nested Cancel returns to the parent",
	},
	{
		file: "sheet-behavior",
		status: "internal",
		job: "The Sheet's key, submit, focus and detent rules as plain functions",
		use: "sheet",
	},
	{
		file: "sheet-state",
		status: "internal",
		job: "The Sheet's state hook: open tracking, focus return, the submit guard, Enter keys and the inline error",
		use: "sheet",
	},
	{
		file: "sidebar",
		status: "core",
		job: "SidebarProvider and today's sidebar parts. The new shell's sidebar is ShellSidebar in src/components/shell/sidebar.tsx",
	},
	{
		file: "skeleton",
		status: "core",
		plan: ["Skeleton"],
		job: "Loading placeholder in place of the content (`shape`, SkeletonRows)",
	},
	{ file: "slider", status: "core", job: "Pick a value on a range" },
	{
		file: "status-dot",
		status: "core",
		plan: ["StatusDot"],
		job: "StatusDot: a status kind from the one status map as a dot plus a word, never color alone (R5)",
	},
	{
		file: "status-map",
		status: "core",
		job: "The one status map (17 kinds, R5): each kind's word key and tone colors, plain data for server and client",
	},
	{
		file: "sonner",
		status: "core",
		job: "The one Toaster, mounted in the root layout. Show a toast with useToast from toast",
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
		plan: ["Table"],
		job: "Desktop table: compare and sort records",
	},
	{
		file: "tabs",
		status: "core",
		plan: ["Tabs"],
		job: 'Tabs: switch whole panes inside one page; `variant="line"` is the underline with the sliding indicator (R21, R24)',
	},
	{ file: "textarea", status: "core", job: "Multi-line text (notes)" },
	{
		file: "toast",
		status: "core",
		plan: ["Toast"],
		job: "Toast: confirms a finished action and offers Undo (R15); at most 3, above sheets",
	},
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
		job: "Name of an icon-only control, a face or a rate (Tip); one clause",
	},
	{
		file: "transaction-status-badge",
		status: "core",
		job: "Shared expense status word on a Badge (Confirmed, Needs review, Settled) from one map (R5)",
	},
	{
		file: "unsaved-changes-dialog",
		status: "core",
		job: "Leave with unsaved changes?",
	},
	{
		file: "user-avatar",
		status: "legacy",
		job: "Old face (10 colors, old sizes) on today's pages; new code uses Face from avatar-face",
		use: "avatar-face (Face)",
	},
];

/** The component names of PLAN §6, row by row (the PLAN is not committed). */
export const PLAN_COMPONENTS: string[] = [
	"PageHeader",
	"Toolbar",
	"Section",
	"SummaryLine",
	"GlanceStrip",
	"NeedsYouList",
	"NeedsYouItem",
	"TransactionRow",
	"Table",
	"PersonRow",
	"ProjectRow",
	"AccountRow",
	"EnvelopeRow",
	"Money",
	"Balance",
	"AvailablePill",
	"StatusDot",
	"Segmented",
	"FilterChips",
	"Tabs",
	"ActionMenu",
	"SwipeActions",
	"Sheet",
	"AddExpenseSheet",
	"SettleSheet",
	"AssignSheet",
	"MoneyInput",
	"CategoryPicker",
	"PersonPicker",
	"DatePicker",
	"Chart",
	"EmptyState",
	"Notice",
	"Toast",
	"Skeleton",
	"Sidebar",
	"BottomNav",
	"AccountMenu",
	"Palette",
];

export type Planned = {
	/** The PLAN §6 name. */
	name: string;
	/** built: it exists at `target` (outside src/components/ui); use it. */
	status: "planned" | "built";
	/** The one job. */
	job: string;
	/** What it replaces (PLAN §6). */
	replaces: string;
	/** The PLAN §6 row it comes from. */
	planRow: string;
	/** Where it will live (IMPLEMENTATION §1.3, §1.2 for sheets). */
	target: string;
	/** What to use until it exists; for a built entry, the component itself. */
	use: string;
};

const LAYOUT = "PageHeader, Toolbar, Section, SummaryLine";
const NEEDS_YOU = "NeedsYouList + NeedsYouItem";
const ROWS = "PersonRow, ProjectRow, AccountRow, EnvelopeRow";
const BALANCE = "Balance, AvailablePill, StatusDot";
const ACTIONS =
	"ActionMenu (registry-driven ⋯, right-click, long press) and SwipeActions (phone)";
const SHEETS = "AddExpenseSheet, SettleSheet, AssignSheet";
const INPUTS = "MoneyInput, CategoryPicker, PersonPicker, DatePicker";
const SHELL = "Sidebar, BottomNav, AccountMenu, Palette";

export const PLANNED: Planned[] = [
	{
		name: "PageHeader",
		status: "built",
		job: "Page title, at most one primary action, the overflow menu; optional faces and one sub line (R1)",
		replaces: "SiteHeader variations and hero cards",
		planRow: LAYOUT,
		target: "src/components/layout/page-header.tsx",
		use: "Import it from src/components/layout/page-header",
	},
	{
		name: "Toolbar",
		status: "built",
		job: "One row under the header: search, filter chips plus Filter menu, view switch at the end (R1)",
		replaces: "Ad hoc filter bars",
		planRow: LAYOUT,
		target: "src/components/layout/toolbar.tsx",
		use: "Import it from src/components/layout/toolbar",
	},
	{
		name: "Section",
		status: "built",
		job: "Flat section: heading, content and space, no border (R2)",
		replaces: "Card around sections",
		planRow: LAYOUT,
		target: "src/components/layout/section.tsx",
		use: "Import it from src/components/layout/section",
	},
	{
		name: "SummaryLine",
		status: "built",
		job: "One glance line of key numbers (Spent ... · Left ...) instead of a tile row (R3)",
		replaces: "7 KPI tile implementations",
		planRow: LAYOUT,
		target: "src/components/layout/summary-line.tsx",
		use: "Import it from src/components/layout/summary-line",
	},
	{
		name: "GlanceStrip",
		status: "built",
		job: "Home's one hero number with its glance line",
		replaces: "4 dashboard StatCards",
		planRow: "GlanceStrip (Home)",
		target: "src/components/glance/glance-strip.tsx",
		use: "GlanceStrip from src/components/glance/glance-strip (view model GlanceVM)",
	},
	{
		name: "NeedsYouList",
		status: "built",
		job: "The list of things that need the person now, one style for every kind",
		replaces:
			"Verification, settlement and import banners and recurring due badges on 5 pages",
		planRow: NEEDS_YOU,
		target: "src/components/needs-you/needs-you-list.tsx",
		use: "NeedsYouList with items from the needsYou read model (NeedsYouItemVM)",
	},
	{
		name: "NeedsYouItem",
		status: "built",
		job: "One Needs you entry: what, who, one action",
		replaces: "Stacked tinted banners",
		planRow: NEEDS_YOU,
		target: "src/components/needs-you/needs-you-item.tsx",
		use: "NeedsYouItem inside NeedsYouList; add a kind to NeedsYouItemVM, never a banner",
	},
	{
		name: "TransactionRow",
		status: "built",
		job: "One expense, payment or transfer row: lead, title, subline, money right (§6)",
		replaces: "4 table stacks and 5 activity renderers",
		planRow: "TransactionRow / Table",
		target: "src/components/rows/transaction-row.tsx (desktop table: src/components/table/transaction-table.tsx)",
		use: "TransactionRow in a RowList on phone, TransactionTable on desktop",
	},
	{
		name: "PersonRow",
		status: "built",
		job: "A person with face, balance words and money right",
		replaces: "Person cards",
		planRow: ROWS,
		target: "src/components/rows/person-row.tsx",
		use: "PersonRow in a RowList",
	},
	{
		name: "ProjectRow",
		status: "built",
		job: "A project with its cover, faces and balance",
		replaces: "Project cards (keeping the cover)",
		planRow: ROWS,
		target: "src/components/rows/project-row.tsx",
		use: "ProjectRow in a RowList; pass the Cover as `cover`",
	},
	{
		name: "AccountRow",
		status: "built",
		job: "A wealth account with its group dot and value",
		replaces: "Wealth table rows on phone",
		planRow: ROWS,
		target: "src/components/rows/account-row.tsx",
		use: "AccountRow in a RowList",
	},
	{
		name: "EnvelopeRow",
		status: "built",
		job: "A budget envelope with progress and available money",
		replaces: "Budget rows",
		planRow: ROWS,
		target: "src/components/rows/envelope-row.tsx",
		use: "EnvelopeRow in a RowList",
	},
	{
		name: "Money",
		status: "built",
		job: "Render one amount (and Money.pair: original first, home second) through the one formatter",
		replaces: "15 local formatters, toFixed and toLocaleString sites",
		planRow: "Money",
		target: "src/components/money/money.tsx",
		use: "Import it from src/components/money/money (Money, Money.pair)",
	},
	{
		name: "Balance",
		status: "built",
		job: "Owed to you or you owe: amount plus the words, never netted (R5, D1)",
		replaces: "Badge, color and verb triplets",
		planRow: BALANCE,
		target: "src/components/money/balance.tsx",
		use: "Import it from src/components/money/balance",
	},
	{
		name: "AvailablePill",
		status: "built",
		job: "Budget money available in an envelope, attention when over",
		replaces: "Badge, color and verb triplets",
		planRow: BALANCE,
		target: "src/components/money/available-pill.tsx",
		use: "Import it from src/components/money/available-pill",
	},
	{
		name: "ActionMenu",
		status: "built",
		job: "The ⋯ menu (ActionMenu), right-click and long press (ActionArea) of an entity, read from one action registry (R8)",
		replaces: "Per-page dropdowns and context menus",
		planRow: ACTIONS,
		target:
			"src/components/actions/action-menu.tsx (actions in src/components/actions/registry.ts, one file per entity)",
		use: "ActionMenu and ActionArea; add an action to the entity's registry file",
	},
	{
		name: "SwipeActions",
		status: "built",
		job: "Phone swipe actions, each with a menu twin from the same registry (R8, R13); swipe stays off on phone web",
		replaces: "Per-page swipe and long-press handling",
		planRow: ACTIONS,
		target: "src/components/actions/swipe-actions.tsx",
		use: "SwipeActions (long press always; swipe only where no browser back gesture competes)",
	},
	{
		name: "AddExpenseSheet",
		status: "planned",
		job: "Add or edit an expense in one Sheet with its preview (R30)",
		replaces: "The expense modal",
		planRow: SHEETS,
		target: "src/features/entry/* (IMPLEMENTATION §1.2, 4G)",
		use: "expense-modal",
	},
	{
		name: "SettleSheet",
		status: "built",
		job: "Settle up with a person: amount, account, what changes, Undo",
		replaces: "The settle-up dialog",
		planRow: SHEETS,
		target: "src/features/settle/settle-sheet.tsx (IMPLEMENTATION §1.2, 4D)",
		use: "SettleSheet from src/features/settle/settle-sheet (uiV2 pages); settle-up-dialog stays on today's pages",
	},
	{
		name: "AssignSheet",
		status: "planned",
		job: "Assign budget money to envelopes",
		replaces: "Budget row inline edit",
		planRow: SHEETS,
		target: "src/features/budget/sheets/* (IMPLEMENTATION §1.2, 4C)",
		use: "The current budget row edit",
	},
	{
		name: "MoneyInput",
		status: "built",
		job: "Amount entry: groups while typing, parses the page locale, + - × ÷ math, currency and rate chips (R22)",
		replaces: "CurrencyAmountInput and local amount inputs",
		planRow: INPUTS,
		target: "src/components/money/money-input.tsx",
		use: "MoneyInput (new screens); CurrencyAmountInput stays in today's expense form",
	},
	{
		name: "CategoryPicker",
		status: "built",
		job: "Pick a category, recents first, bare glyph in its color (R25)",
		replaces: "4 category pickers",
		planRow: INPUTS,
		target: "src/components/pickers/category-picker.tsx",
		use: "CategoryPicker in a PickerPopover; do not add a fifth",
	},
	{
		name: "PersonPicker",
		status: "built",
		job: "Pick people with their faces",
		replaces: "split-with-picker and add-people-search",
		planRow: INPUTS,
		target: "src/components/pickers/person-picker.tsx",
		use: "PersonPicker in a PickerPopover",
	},
	{
		name: "DatePicker",
		status: "built",
		job: "Pick a day: Today, Yesterday, then a month calendar or a typed date. Date filters use DateRange (presets, two months, typed, Compare) in the same folder",
		replaces:
			"4 date pickers, the by-month grid and the custom from and to fields",
		planRow: INPUTS,
		target:
			"src/components/pickers/date-picker.tsx (DateRange: src/components/pickers/date-range.tsx)",
		use: "DatePicker or DateRange",
	},
	{
		name: "Sidebar",
		status: "built",
		job: "Desktop and tablet sidebar: split Add, the six destinations, Tools, pinned projects, account (behind uiV2Mode)",
		replaces: "app-sidebar, nav-main and nav-secondary",
		planRow: SHELL,
		target: "src/components/shell/sidebar.tsx (items from src/lib/nav.ts)",
		use: "ShellSidebar, rendered by AppShell (src/components/shell/app-shell.tsx)",
	},
	{
		name: "BottomNav",
		status: "built",
		job: "Phone web tab bar: Home, Activity, Budget, People, Projects plus a separate +",
		replaces: "Hamburger-only mobile nav",
		planRow: SHELL,
		target: "src/components/shell/bottom-nav.tsx (items from src/lib/nav.ts)",
		use: "BottomNav and FloatingAdd, rendered by AppShell",
	},
	{
		name: "AccountMenu",
		status: "built",
		job: "Account menu at the sidebar bottom: Settings, Admin, Invite codes, Feedback, Docs, Release notes, Sign out; the account sheet on phones",
		replaces: "nav-user and 3 feedback entries",
		planRow: SHELL,
		target: "src/components/shell/account-menu.tsx",
		use: "AccountMenu (desktop) and AccountSheet (phone), rendered by AppShell",
	},
];
