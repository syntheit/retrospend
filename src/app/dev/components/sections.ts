/**
 * The gallery's sections, in components.html order. Each names the PLAN §6
 * components it shows (the gallery test checks every one has a section) and
 * carries its documentation: what it is for, never for, what it replaces.
 * This is developer documentation for a dev-only page, like the registry's
 * job lines, so it stays in English and out of the message catalogs.
 */
export type GallerySection = {
	id: string;
	/** Short label in the section nav. */
	nav: string;
	title: string;
	/** PLAN §6 names shown here. */
	components: string[];
	use: string;
	never: string;
	replaces: string;
	/** Set while the component's stream has not merged: who builds it. */
	pending?: string;
};

export const SECTIONS: GallerySection[] = [
	{
		id: "datacontract",
		nav: "Data contract",
		title: "Data contract: view models, figures, Undo",
		components: [],
		use: "every component takes a view model: amounts as Money in minor units, shares in hundredths of a percent, dates as ISO. The server computes them (R9); the figure key rides along for the audit.",
		never:
			"numbers typed into a page, sums of rows in a component, a toast that says Saved when nothing changed.",
		replaces: "page-local data blocks that made pages disagree.",
	},
	{
		id: "tokens",
		nav: "Tokens",
		title: "Tokens",
		components: [],
		use: "every color, size and space in the app comes from here.",
		never: "a hex value or a size that is not on the scale.",
		replaces: "ad hoc hex, 15 formatters, six font sizes under 12px.",
	},
	{
		id: "refresh",
		nav: "Icons and buttons",
		title: "Icon and button refresh (N66)",
		components: [],
		use: "meaning first: if an icon reads right, it stays. Changed ones below; everything else kept.",
		never:
			"an icon chosen for looks, or two icons that look alike next to each other.",
		replaces: "handshake for Settle up, solid brand filter chips.",
	},
	{
		id: "motion",
		nav: "Motion",
		title: "Motion (R24)",
		components: [],
		use: "state you can follow: a tab underline slides, removed rows collapse and come back on Undo, sheets rise and sink. Tokens: state 120ms, menus 160ms, sheets and tabs 220ms, rows 200ms.",
		never:
			"counting up money, bounce or springs, or motion that delays input. Reduced motion: opacity only.",
		replaces: "instant swaps and per-page transitions.",
	},
	{
		id: "structure",
		nav: "Page structure",
		title: "PageHeader, Toolbar, Section, SummaryLine",
		components: ["PageHeader", "Toolbar", "Section", "SummaryLine"],
		use: "the one page skeleton: header, toolbar, content. At most one primary action.",
		never: "anything between header and toolbar, or a second primary button.",
		replaces: "SiteHeader variations, 7 KPI tile implementations, hero cards.",
	},
	{
		id: "avatar",
		nav: "Avatars",
		title: "Face and FaceStack",
		components: [],
		use: "faces wherever a set of people appears. Hover the stack: it spreads and each face names itself. The payer comes first, with an accent ring when someone else paid.",
		never:
			"a list of names when faces fit, or a colored circle with no initials and no picture.",
		replaces: 'named avatar chips, "4 people" text, plain gray initials.',
	},
	{
		id: "pagetabs",
		nav: "Page tabs",
		title: "PageTabs (underline)",
		components: [],
		use: "moving between sibling pages under one destination, like Activity: Expenses and Recurring. Real links with aria-current.",
		never:
			"switching a view of the same data in place (Segmented), or panes inside one page (Tabs).",
		replaces:
			"the round 1 Expenses / Recurring / Import segmented control (N43).",
	},
	{
		id: "daterange",
		nav: "Date range",
		title: "DateRange",
		components: [],
		use: "any date filter: presets first, then a two-month calendar, typed From and To, and Compare to previous period.",
		never: "a month-only menu, or a second date picker.",
		replaces:
			"period presets, the by-month grid and the custom from and to fields.",
	},
	{
		id: "identity",
		nav: "Identity in pickers",
		title: "Identity in pickers (R25, amended by R31)",
		components: [],
		use: "menus and pickers show the bare glyph in the category color, a face, a project cover or an account group dot; the tinted tile only in list and table rows; chips are text only.",
		never: "a tinted tile inside a chip or a menu, or a color with no name.",
		replaces: "menus with plain names (N52) and tiles on every chip (R31).",
	},
	{
		id: "glance",
		nav: "GlanceStrip",
		title: "GlanceStrip",
		components: ["GlanceStrip"],
		use: 'the Home answer to "am I OK?": one hero, a pace line, then only the rows with something to say.',
		never:
			"a row of equal tiles, or any figure that repeats elsewhere on the same screen.",
		replaces: "4 dashboard StatCards.",
	},
	{
		id: "needs",
		nav: "Needs you",
		title: "NeedsYouList and NeedsYouItem",
		components: ["NeedsYouList", "NeedsYouItem"],
		use: "anything waiting on the user: assign income, review, confirm, due, overdue. One sentence, one action.",
		never: "info banners, tips or things that need no action.",
		replaces:
			"verification banners, settlement banners, import queue prompts, recurring due badges.",
	},
	{
		id: "transaction",
		nav: "Transactions",
		title: "TransactionRow and Table",
		components: ["TransactionRow", "Table"],
		use: "one expense. Table on desktop (sortable, selectable), rows on phone. Original amount first, home amount second when foreign.",
		never: "a second renderer. Never a table on a phone.",
		replaces: "4 table stacks and 5 activity renderers.",
	},
	{
		id: "person",
		nav: "Person",
		title: "PersonRow",
		components: ["PersonRow"],
		use: 'a person with one balance. "Not on Retrospend" is a status under the name.',
		never: "repeating the balance as tiles, chips and a heading.",
		replaces: "person cards.",
	},
	{
		id: "project",
		nav: "Project",
		title: "ProjectRow (cover stays)",
		components: ["ProjectRow"],
		use: "a project: the cover is content. Your balance in a shared project, total spent in a solo one, a thin bar when there is a budget.",
		never:
			"decoration. The cover is a photo or a flat placeholder, never a gradient.",
		replaces: "project cards.",
	},
	{
		id: "account",
		nav: "Account",
		title: "AccountRow and Allocation",
		components: ["AccountRow"],
		use: "a wealth account: native amount first, home equivalent under it when the currency differs. Liabilities are negative and stay neutral. Allocation splits a total by series.",
		never: "a table on phone, or a series color on a liability.",
		replaces: "wealth table rows on phone, the allocation donut.",
	},
	{
		id: "envelope",
		nav: "Envelope",
		title: "EnvelopeRow and AvailablePill",
		components: ["EnvelopeRow"],
		use: "a budget envelope: icon, name, thin bar, one Available pill with a word.",
		never: "showing Assigned and Activity on the row. They live in the detail.",
		replaces: "budget rows with double numbers.",
	},
	{
		id: "recurring",
		nav: "Recurring",
		title: "Recurring row",
		components: [],
		use: "a recurring expense: next date, status in words, Confirm and Skip on desktop.",
		never: "a subscription list with badges.",
		replaces: "recurring due badges.",
	},
	{
		id: "money",
		nav: "Money and status",
		title: "Money, Balance, AvailablePill, StatusDot",
		components: ["Money", "Balance", "AvailablePill", "StatusDot"],
		use: "every amount and every status, through the one formatter.",
		never: "toFixed, toLocaleString, or color alone to carry meaning.",
		replaces: "15 local formatters; badge, color and verb triplets.",
	},
	{
		id: "picks",
		nav: "Segmented, chips, tabs",
		title: "Segmented, FilterChips, Tabs",
		components: ["Segmented", "FilterChips", "Tabs"],
		use: "one pick-one control (Segmented), one filter pattern (chips plus Filter menu), Tabs to switch whole panes.",
		never: "stacking two of the same kind, or tabs that only change a filter.",
		replaces: "25 pick-one controls in 3 APIs.",
	},
	{
		id: "buttons",
		nav: "Buttons",
		title: "Buttons and form controls",
		components: [],
		use: "actions and inputs. One primary per page header; danger only for destructive actions.",
		never: "a lookalike. Never a pill-shaped button.",
		replaces: "pill, button and control soup.",
	},
	{
		id: "menu",
		nav: "Menu and swipe",
		title: "ActionMenu and SwipeActions",
		components: ["ActionMenu", "SwipeActions"],
		use: "every action on an entity. One registry per entity feeds the three-dot menu, right-click, long press and swipe.",
		never: "a per-page dropdown or a swipe with no menu twin.",
		replaces: "per-page dropdowns and context menus.",
	},
	{
		id: "sheet",
		nav: "Sheet",
		title: "Sheet",
		components: ["Sheet", "AddExpenseSheet", "SettleSheet", "AssignSheet"],
		use: "one task that finishes in place. A dialog on desktop, a detent sheet (medium, large) on phone.",
		never: "a second sheet for the same task, or a page-length form.",
		replaces: "ResponsiveDialog, Drawer and Dialog variants.",
		pending:
			"AddExpenseSheet, SettleSheet and AssignSheet arrive with their pages (S4).",
	},
	{
		id: "moneyinput",
		nav: "Inputs",
		title: "MoneyInput",
		components: ["MoneyInput"],
		use: "entering an amount, amount first. Currency chip, rate chip with source and date when foreign.",
		never: "a plain text field for money.",
		replaces: "ad hoc amount inputs.",
	},
	{
		id: "catpick",
		nav: "Pickers",
		title: "CategoryPicker, PersonPicker, ProjectPicker, DatePicker",
		components: [
			"CategoryPicker",
			"PersonPicker",
			"ProjectPicker",
			"DatePicker",
		],
		use: "choosing a category (recents first), people (with their status) and a date (presets first).",
		never: "a fourth category picker.",
		replaces: "4 category pickers, 4 date pickers.",
	},
	{
		id: "chart",
		nav: "Charts",
		title:
			"Chart: pace line, monthly bars, ranked bars, area with scrub, allocation, balance bar",
		components: ["Chart"],
		use: "the chart shapes, from one spec. Lines, areas and bars use the accent; several series use series 1 to 8 in order. Hover for values; reduced motion draws in place.",
		never: "a new chart type, hex colors, or text under 12px.",
		replaces: "per-file recharts configs with hex colors.",
	},
	{
		id: "feedback",
		nav: "Feedback",
		title: "EmptyState, Notice, Toast, Skeleton",
		components: ["EmptyState", "Notice", "Toast", "Skeleton"],
		use: "empty lists, one inline notice, undo toasts for every money mutation, loading shapes.",
		never: "amber boxes, explanatory paragraphs, or spinners on lists.",
		replaces: "ad hoc empty texts and amber boxes.",
	},
	{
		id: "shell",
		nav: "Navigation",
		title: "Sidebar, AccountMenu, Palette",
		components: ["Sidebar", "AccountMenu", "Palette"],
		use: "desktop navigation: six destinations, then Tools, then Pinned projects; global Add, account menu, Cmd+K.",
		never:
			"a hamburger, more than six destinations, or a tool hidden in the account menu.",
		replaces: "hamburger-only mobile nav, 3 feedback entries.",
	},
	{
		id: "bottomnav",
		nav: "Bottom nav",
		title: "BottomNav",
		components: ["BottomNav"],
		use: "phone navigation: Home, Activity, Budget, People, Projects, plus a floating Add.",
		never: "rows, charts or numbers in glass. Never a center plus tab.",
		replaces: "hamburger-only mobile nav.",
	},
	{
		id: "tooltip",
		nav: "Tooltip",
		title: "Tooltip",
		components: [],
		use: "the rate behind a foreign amount, or the name of an icon-only button. Hover or focus; fine pointers only.",
		never: "anything a person must read to finish a task.",
		replaces: "title attributes.",
	},
];

/** Captions inside the sections: developer documentation, like SECTIONS. */
export const CAP = {
	desktop: "Desktop",
	phone: "Phone",
	iphone: "iPhone",
	listFlat: "List (flat, hairlines)",
	listGroup: "List group",
	glanceA: "A. Glance line and rows (recommended)",
	glanceB: "B. Compact 3-number strip",
	glanceNoRate: "Missing rate: no spent figure, the budget line names the currency",
	itemDefault: "Item default",
	itemOverdue: "Overdue (amber icon, word in the sentence)",
	itemSetup: "Setup prompt with a context line (new user)",
	itemRejected: "Rejected split",
	itemBudget: "Budget prompt (missing rate, named)",
	allClear: "Empty, nothing needs you",
	table:
		"Desktop table. Hover a row, select with the checkbox or a click (shift-click for a range), right-click or use the three-dot button.",
	phoneRows:
		"Phone web rows: unreviewed, USD, BRL, split, plain, a pending payment. Three-dot button and long press.",
	swipe:
		"Swipe (iPhone idiom, off on phone web): drag a row left or right. Every swipe has a menu twin.",
	loading: "Loading (table)",
	loadingRows: "Loading (phone rows)",
	zero: "Zero: nothing yet, the total says 0",
	noMatch: "Empty (no match)",
	coverCard:
		"The cover slot takes the Cover component (photo or illustrated scene) once it is built; until then a flat tile.",
	allocation: "Allocation: assets by group",
	pace: "Pace line, this month against last",
	bars: "Monthly bars",
	area: "Net worth area: move across it to scrub",
	ranked: "Ranked bars (category hue means only which category)",
	balance: "Balance bar: who makes up owed and owe",
	previous: "Last month",
	reduced: "Reduced motion turns chart animation off.",
	emptySeries: "No data: every month a gap",
	emptyPace: "No data: an empty series",
	fixtures:
		"Static fixtures shaped like the server's view models. Not your data.",
} as const;
