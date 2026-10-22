// uiRules: the [auto] items of docs/ui/CHECKLIST.md as a source scan.
//
// Pure: scanFile(file, text) returns the violations in one file. scan.ts walks
// the tree and compares per-file counts with baseline.json (the ratchet);
// rules.test.ts unit-tests every rule with a hit and a miss.
//
// `file` is relative to the repo root with forward slashes, for example
// "src/components/ui/button.tsx" or "messages/en.json".
//
// How it scans:
//  * TS/TSX is parsed with oxc (vite's parseSync). Comments never match: they
//    are not in the AST.
//  * Class and value rules run regexes over string literal values and
//    template literal parts, never over code or comments. Bare words that are
//    also English (uppercase, shadow, rounded) only count inside a class
//    context: className, cn(), clsx(), cva(), twMerge(), or a variable or
//    property whose name ends in "class", "classes" or "className".
//  * JSX-shaped rules (raw elements, icon-only buttons, money next to an
//    interpolation, imports) use the AST.
//  * CSS has its comments blanked first; colors are checked in declarations
//    only, never in selectors.
//  * messages/*.json (the UI copy) is checked line by line, values only.
//
// Accepted limits (known, not bugs):
//  * The ratchet counts per rule and file: a fix and a new violation in the
//    same file cancel out. allow.json exempts a whole file for a rule.
//  * A class list built at runtime is checked piece by piece; a utility split
//    across two literals is not seen.
//  * Tailwind's implicit 150ms on `transition` is not seen (no literal).
//  * date-fns `format()` is not flagged by UI-070; dates still belong in the
//    date helpers (src/lib/date-locale.ts).
//  * UI-071 sees a symbol written next to an interpolation; a symbol held in a
//    variable (`${symbol}${amount}`) is not seen.
import { parseSync } from "vite";
import { REGISTRY } from "../../components/ui/registry";

export type Hit = {
	rule: string;
	file: string;
	line: number;
	match: string;
	message: string;
};

export const RULES: Record<string, string> = {
	"UI-001":
		"Raw color literal; use a color token (GUIDELINE §2.1). Only the token files define colors.",
	"UI-002":
		"Tailwind palette color (emerald-600, blue-500, white, black); use a token such as text-positive or bg-surface (GUIDELINE §2.1).",
	"UI-010":
		"Font size off the type scale or under 12px; use text-hero, text-title, text-section, text-body, text-small, text-meta (GUIDELINE §2.3).",
	"UI-011":
		"Font weight outside 400/500/600; use font-normal, font-medium or font-semibold (GUIDELINE §2.3).",
	"UI-012":
		"Uppercase or letter-spaced label (eyebrow); write it in sentence case (GUIDELINE §2.3).",
	"UI-020":
		"Spacing off the 4/8/12/16/24/32/48 scale; use steps 1, 2, 3, 4, 6, 8, 12 or a size token (GUIDELINE §2.4).",
	"UI-021":
		"Radius off the tokens; use rounded-ctl, rounded-panel, rounded-chip (or lg, xl, full) (GUIDELINE §2.4).",
	"UI-030": "Gradient; the UI is flat (GUIDELINE §17, R31).",
	"UI-031":
		"Glow, decorative shadow or blur; only shadow-menu (floating layers) and shadow-ctl (selected segment) exist (GUIDELINE §2.5, R31).",
	"UI-032":
		"Accent stripe (thick or colored one-sided border); hierarchy comes from type and space (GUIDELINE §17, R31).",
	"UI-033":
		"Sparkle, magic wand or stars icon; use a plain icon that names the action, or none (GUIDELINE §2.7, R31).",
	"UI-034":
		"Second icon set; icons come from lucide-react only (GUIDELINE §2.7).",
	"UI-035": "Emoji in UI text; icons are lucide glyphs (GUIDELINE §2.7).",
	"UI-041":
		"Import of a legacy or internal primitive; use the primitive the registry names (GUIDELINE §4).",
	"UI-042":
		"Raw button, input, select, textarea or table; use the registered primitive (GUIDELINE §4).",
	"UI-070":
		"Number, money or date formatted by hand; use the formatters in src/lib (GUIDELINE §7).",
	"UI-071":
		"Money string built by hand (currency symbol next to a value); use the money formatter (GUIDELINE §7).",
	"UI-100":
		"Duration off the motion tokens (80, 120, 140, 160, 200, 220 ms); use duration-(--t-*) (GUIDELINE §11).",
	"UI-101":
		"Bounce or overshoot; motion lands without overshoot (GUIDELINE §11, R24).",
	"UI-120":
		"Em dash in UI text; use a comma, colon or period (GUIDELINE §13, R11).",
	"UI-121":
		"Word the glossary replaces (log in, participant, receivable...); use the glossary word (GUIDELINE §13).",
	"UI-130":
		"Focus outline removed without a focus-visible replacement (GUIDELINE §14).",
	"UI-131":
		"Icon-only button without an accessible name; add aria-label (GUIDELINE §14).",
};

// ---- scope ----------------------------------------------------------------

/** Files the scan covers: src/**.{ts,tsx,css} (minus tests and src/test) and the message catalogs. */
export function inScope(file: string): boolean {
	if (/^messages\/[\w-]+\.json$/.test(file)) return true;
	if (!file.startsWith("src/")) return false;
	if (!/\.(ts|tsx|css)$/.test(file) || file.endsWith(".d.ts")) return false;
	if (file.startsWith("src/test/")) return false;
	if (/\.test\.tsx?$/.test(file) || file.includes("/__tests__/")) return false;
	return true;
}

const UI_DIRS = [
	"src/app/",
	"src/components/",
	"src/hooks/",
	"src/lib/",
	"src/styles/",
];
/** Rules about copy run everywhere (server errors reach toasts); the rest only in UI code. */
const COPY_RULES = new Set(["UI-120", "UI-035"]);
const isUi = (file: string) => UI_DIRS.some((d) => file.startsWith(d));

/** The token files: the only places that define raw colors (custom properties). */
export const THEME_FILES = new Set([
	"src/styles/tokens.css",
	"src/styles/globals.css",
]);

/** Formatter modules: the only places that call Intl, toLocaleString or toFixed. */
export const FORMATTERS = new Set([
	"src/lib/currency-format.ts",
	"src/lib/money.ts",
	"src/lib/format.ts",
	"src/lib/date-locale.ts",
	"src/lib/date.ts",
	"src/lib/time-zone.ts",
	"src/lib/decimal.ts",
]);

const EXEMPT: Record<string, (file: string) => boolean> = {
	"UI-041": (f) => f.startsWith("src/components/ui/"),
	"UI-042": (f) => f.startsWith("src/components/ui/"),
	"UI-070": (f) => FORMATTERS.has(f),
	"UI-100": (f) => f === "src/styles/tokens.css",
};

function applies(rule: string, file: string): boolean {
	if (EXEMPT[rule]?.(file)) return false;
	if (file.startsWith("messages/")) return true;
	return COPY_RULES.has(rule) || isUi(file);
}

// ---- shared patterns ------------------------------------------------------

type Raw = { rule: string; line: number; match: string };

/** Not preceded by a class-name character (variants like `md:` and `!` are fine). */
const NB = String.raw`(?<![\w-])`;
const END = String.raw`(?![\w-])`;
const PALETTE =
	"slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white";
const COLOR_UTIL =
	"bg|text|border(?:-[xytrblse])?|ring|ring-offset|outline|fill|stroke|from|via|to|decoration|divide|placeholder|caret|accent|shadow|inset-shadow|drop-shadow";

export const MOTION_MS = new Set([0, 1, 80, 120, 140, 160, 200, 220]);
const toMs = (n: string, unit: string) =>
	unit === "s" ? Math.round(Number(n) * 1000) : Number(n);

/** U+2014, written as a code so this file has no em dash in it. */
const EM_DASH = new RegExp(String.fromCharCode(0x2014));
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u;
/** Glossary (GUIDELINE §13): the words on the left are replaced. */
const GLOSSARY =
	/(?<![\w-])(?:log(?:ged)? ?in|log ?out|log(?:ged)? ?out|participants?|shadow profiles?|ghost (?:users?|profiles?)|square(?:d)? up|pay(?:ing)? off|receivables?|payables?|portfolios?)(?![\w-])/i;

/** cubic-bezier(x1, y1, x2, y2) with y1 or y2 outside 0..1 overshoots. */
function overshoots(text: string): string[] {
	const out: string[] = [];
	const re =
		/cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/g;
	for (let m = re.exec(text); m; m = re.exec(text)) {
		const y1 = Number(m[2]);
		const y2 = Number(m[4]);
		if (y1 < 0 || y1 > 1 || y2 < 0 || y2 > 1) out.push(m[0]);
	}
	return out;
}

type TokenRule = {
	rule: string;
	re: RegExp;
	/** Only in class contexts (bare words that are also prose). */
	classOnly?: boolean;
	/** Skip a match when this returns false. */
	accept?: (m: RegExpExecArray) => boolean;
};

const SPACING_OK = new Set([
	"0",
	"px",
	"0.5",
	"1",
	"2",
	"3",
	"4",
	"6",
	"8",
	"12",
	"auto",
]);
const SPACE_UTIL = String.raw`-?(?:p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy])`;
const RADIUS_SIDE = String.raw`(?:-(?:t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee))?`;
const SIDE_OK_COLORS = new Set([
	"line",
	"line-strong",
	"border",
	"input",
	"transparent",
	"inherit",
]);

/** Arbitrary value that only wraps a token or the safe area is fine. */
const tokenArbitrary = (v: string) =>
	/^\[?(?:var\(--|calc\(.*env\(|env\()/.test(v) || v.startsWith("(--");

const TOKEN_RULES: TokenRule[] = [
	// UI-002 palette colors
	{
		rule: "UI-002",
		re: new RegExp(
			`${NB}(?:${COLOR_UTIL})-(?:${PALETTE})(?:-\\d{2,3})?(?:\\/[\\w.]+)?${END}`,
			"g",
		),
	},
	// UI-010 font sizes
	{ rule: "UI-010", re: new RegExp(`${NB}text-(?:lg|xl|[2-9]xl)${END}`, "g") },
	{
		rule: "UI-010",
		re: new RegExp(`${NB}text-\\[(?:length:)?[\\d.]+(?:px|rem|em)\\]`, "g"),
	},
	// UI-011 weights
	{
		rule: "UI-011",
		re: new RegExp(
			`${NB}font-(?:bold|extrabold|black|light|extralight|thin)${END}`,
			"g",
		),
	},
	// UI-012 eyebrows
	{
		rule: "UI-012",
		re: new RegExp(`${NB}uppercase${END}`, "g"),
		classOnly: true,
	},
	{
		rule: "UI-012",
		re: new RegExp(
			`${NB}tracking-(?:wide|wider|widest|\\[[^\\]]*\\])${END}`,
			"g",
		),
	},
	// UI-020 spacing
	{
		rule: "UI-020",
		re: new RegExp(
			`${NB}${SPACE_UTIL}-(\\[[^\\]]+\\]|\\([^)]+\\)|[\\d.]+)(?![\\w.-])`,
			"g",
		),
		accept: (m) => {
			const v = m[1] ?? "";
			if (v.startsWith("[") || v.startsWith("(")) return !tokenArbitrary(v);
			return !SPACING_OK.has(v);
		},
	},
	// UI-021 radius
	{
		rule: "UI-021",
		re: new RegExp(
			`${NB}rounded${RADIUS_SIDE}-(?:xs|sm|md|2xl|3xl|4xl)${END}`,
			"g",
		),
	},
	{
		rule: "UI-021",
		re: new RegExp(`${NB}rounded${RADIUS_SIDE}-(\\[[^\\]]+\\])`, "g"),
		accept: (m) => !tokenArbitrary(m[1] ?? ""),
	},
	{
		rule: "UI-021",
		re: new RegExp(`${NB}rounded${RADIUS_SIDE}${END}`, "g"),
		classOnly: true,
	},
	// UI-030 gradients
	{
		rule: "UI-030",
		re: new RegExp(
			`${NB}bg-(?:gradient|linear|radial|conic)(?:-[\\w\\[\\]./()-]*)?`,
			"g",
		),
	},
	{ rule: "UI-030", re: /(?:repeating-)?(?:linear|radial|conic)-gradient\(/g },
	// UI-031 shadows, glows, blur blobs
	{
		rule: "UI-031",
		re: new RegExp(`${NB}(?:drop-|inset-)?shadow-([\\w\\[\\]().,#/%-]+)`, "g"),
		accept: (m) => !["none", "menu", "ctl"].includes(m[1] ?? ""),
	},
	{
		rule: "UI-031",
		re: new RegExp(`${NB}(?:drop-)?shadow${END}`, "g"),
		classOnly: true,
	},
	{
		rule: "UI-031",
		re: new RegExp(`${NB}blur(?:-[\\w\\[\\]./-]+)?${END}`, "g"),
		classOnly: true,
	},
	// UI-032 accent stripes
	{
		rule: "UI-032",
		re: new RegExp(`${NB}border-[lrtbse]-(\\d+|\\[[^\\]]+\\])`, "g"),
		accept: (m) => {
			const v = m[1] ?? "";
			return v.startsWith("[") ? !/^\[(?:1px|0)/.test(v) : Number(v) >= 2;
		},
	},
	{
		rule: "UI-032",
		re: new RegExp(
			`${NB}border-[lrtbse]-([a-z][\\w-]*)(?:\\/[\\w.]+)?${END}`,
			"g",
		),
		accept: (m) => !SIDE_OK_COLORS.has(m[1] ?? ""),
	},
	// UI-100 durations
	{
		rule: "UI-100",
		re: new RegExp(`${NB}duration-(\\d+)${END}`, "g"),
		accept: (m) => !MOTION_MS.has(Number(m[1])),
	},
	{
		rule: "UI-100",
		re: new RegExp(`${NB}duration-\\[([\\d.]+)(ms|s)\\]`, "g"),
		accept: (m) => !MOTION_MS.has(toMs(m[1] ?? "0", m[2] ?? "ms")),
	},
	// UI-101 bounce
	{ rule: "UI-101", re: new RegExp(`${NB}animate-(?:bounce|ping)${END}`, "g") },
	// UI-130 handled separately (needs the whole class list)
];

/** Raw color literals: hex and color functions. */
const HEX =
	/(?<![\w&/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/g;
const COLOR_FN = /(?<![\w-])(?:rgba?|hsla?|oklch|oklab|hwb)\(/g;

function lineStarts(text: string): number[] {
	const starts = [0];
	for (let i = 0; i < text.length; i++)
		if (text.charCodeAt(i) === 10) starts.push(i + 1);
	return starts;
}

function lineOf(starts: number[], index: number): number {
	let lo = 0;
	let hi = starts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if ((starts[mid] ?? 0) <= index) lo = mid;
		else hi = mid - 1;
	}
	return lo + 1;
}

/** Durations written in a CSS-ish value: "opacity 250ms ease, color .2s". */
function badDurations(value: string): string[] {
	const out: string[] = [];
	const re = /(?<![\w-])(\d*\.?\d+)(ms|s)(?![\w-])/g;
	for (let m = re.exec(value); m; m = re.exec(value)) {
		const ms = toMs(m[1] ?? "0", m[2] ?? "ms");
		// Under 10ms is a reduced-motion kill switch, not a design duration.
		if (ms >= 10 && !MOTION_MS.has(ms)) out.push(m[0]);
	}
	return out;
}

/** A focus-visible utility that draws a visible indicator. */
const VISIBLE_FOCUS =
	/(?<![\w-])(?:[\w-]+:)*focus-visible:(?:outline-(?!none(?![\w-])|hidden|offset|0(?![\w-]))[\w[\]./-]+|outline(?![\w-])|ring(?:-[\w[\]./-]+)?|border-[\w[\]./-]+|bg-[\w[\]./-]+)/;

// ---- string chunks ---------------------------------------------------------

type Chunk = {
	/** The string value. */
	text: string;
	start: number;
	classCtx: boolean;
	/** JSX attribute or object key the literal is the value of. */
	owner?: string;
	/** Inside a console.* call: not UI text. */
	console: boolean;
	/** Visible copy: a text prop (title, label, placeholder...) or a toast message. */
	isText: boolean;
};

/** Values of these props and keys are visible copy (glossary applies). */
const TEXT_PROPS = new Set([
	"title",
	"label",
	"placeholder",
	"aria-label",
	"alt",
	"description",
	"message",
	"text",
	"tooltip",
	"heading",
]);
const TOAST = new Set([
	"toast",
	"success",
	"error",
	"info",
	"warning",
	"message",
	"loading",
]);

/** A string that is a CSS transition or animation value ("opacity 300ms ease"). */
const CSS_TRANSITION =
	/(?:^|,\s*)(?:all|opacity|transform|translate|scale|color|background(?:-color)?|border(?:-color)?|height|width|max-height|filter|box-shadow|top|left|right|bottom|margin|padding|stroke-dashoffset|fill)\s+\d*\.?\d+m?s\b|\d*\.?\d+m?s\s+(?:ease|linear|cubic-bezier|steps)/;

function runTokenRules(chunk: Chunk, line: (i: number) => number, out: Raw[]) {
	for (const r of TOKEN_RULES) {
		if (r.classOnly && !chunk.classCtx) continue;
		const re = new RegExp(r.re.source, r.re.flags);
		for (let m = re.exec(chunk.text); m; m = re.exec(chunk.text)) {
			if (r.accept && !r.accept(m)) continue;
			out.push({
				rule: r.rule,
				line: line(chunk.start + m.index),
				match: m[0],
			});
		}
	}
	for (const s of overshoots(chunk.text))
		out.push({ rule: "UI-101", line: line(chunk.start), match: s });
	// UI-001 raw colors (anchors such as href="#add" are not colors)
	if (
		!(chunk.owner && /^(?:href|to|id|htmlFor|hash|key|name)$/.test(chunk.owner))
	) {
		for (const re of [HEX, COLOR_FN]) {
			const g = new RegExp(re.source, re.flags);
			for (let m = g.exec(chunk.text); m; m = g.exec(chunk.text)) {
				out.push({
					rule: "UI-001",
					line: line(chunk.start + m.index),
					match: m[0],
				});
			}
		}
	}
	// UI-130 outline removed in a class list without a visible focus style
	if (
		chunk.classCtx &&
		/(?<![\w-:])outline-(?:none|hidden)(?![\w-])/.test(chunk.text) &&
		!VISIBLE_FOCUS.test(chunk.text)
	) {
		out.push({
			rule: "UI-130",
			line: line(chunk.start),
			match: "outline-none",
		});
	}
	// UI-100 durations in transition/animation strings
	if (
		CSS_TRANSITION.test(chunk.text) &&
		!STYLE_DURATION_KEYS.has(chunk.owner ?? "")
	) {
		for (const d of badDurations(chunk.text))
			out.push({ rule: "UI-100", line: line(chunk.start), match: d });
	}
	copyRules(chunk.text, line(chunk.start), out, chunk.console, chunk.isText);
}

/** Copy rules shared by literals, JSX text and messages. */
function copyRules(
	text: string,
	line: number,
	out: Raw[],
	isConsole: boolean,
	glossary = false,
) {
	if (isConsole) return;
	if (EM_DASH.test(text))
		out.push({ rule: "UI-120", line, match: excerpt(text, EM_DASH) });
	const emoji = EMOJI.exec(text);
	if (emoji) out.push({ rule: "UI-035", line, match: emoji[0] });
	if (glossary) {
		const g = GLOSSARY.exec(text);
		if (g) out.push({ rule: "UI-121", line, match: g[0] });
	}
}

function excerpt(text: string, re: RegExp): string {
	const i = text.search(re);
	return text
		.slice(Math.max(0, i - 20), i + 20)
		.replace(/\s+/g, " ")
		.trim();
}

// ---- AST helpers -----------------------------------------------------------

type Node = {
	type: string;
	start: number;
	end: number;
	[key: string]: unknown;
};

const isNode = (v: unknown): v is Node =>
	typeof v === "object" &&
	v !== null &&
	typeof (v as { type?: unknown }).type === "string";

function kids(n: Node): Node[] {
	const out: Node[] = [];
	for (const [k, v] of Object.entries(n)) {
		if (k === "type" || k === "start" || k === "end") continue;
		if (Array.isArray(v)) {
			for (const c of v) if (isNode(c)) out.push(c);
		} else if (isNode(v)) out.push(v);
	}
	return out;
}

function walk(n: Node, stack: Node[], fn: (n: Node, stack: Node[]) => void) {
	fn(n, stack);
	stack.push(n);
	for (const c of kids(n)) walk(c, stack, fn);
	stack.pop();
}

const get = (n: Node | undefined, key: string): Node | undefined => {
	const v = n?.[key];
	return isNode(v) ? v : undefined;
};
const str = (n: Node | undefined, key: string): string | undefined => {
	const v = n?.[key];
	return typeof v === "string" ? v : undefined;
};

/** The cooked text of a TemplateElement (its `value` is not a node). */
function cooked(n: Node | undefined): string | undefined {
	const v = n?.value as { cooked?: unknown } | undefined;
	return typeof v?.cooked === "string" ? v.cooked : undefined;
}

function nameOf(n: Node | undefined): string | undefined {
	if (!n) return undefined;
	if (
		n.type === "Identifier" ||
		n.type === "JSXIdentifier" ||
		n.type === "PrivateIdentifier"
	)
		return str(n, "name");
	if (n.type === "Literal")
		return typeof n.value === "string" ? n.value : undefined;
	if (n.type === "JSXMemberExpression") return nameOf(get(n, "property"));
	if (n.type === "JSXNamespacedName")
		return `${nameOf(get(n, "namespace"))}:${nameOf(get(n, "name"))}`;
	return undefined;
}

const CLASS_FNS = new Set([
	"cn",
	"clsx",
	"cva",
	"twMerge",
	"classNames",
	"cx",
	"tv",
]);
const CLASS_NAME = /class(?:es|Name|Names)?$/i;

function context(stack: Node[]): Omit<Chunk, "text" | "start"> {
	let classCtx = false;
	let owner: string | undefined;
	let isConsole = false;
	let isText = false;
	for (let i = stack.length - 1; i >= 0; i--) {
		const n = stack[i] as Node;
		const direct = i === stack.length - 1;
		if (n.type === "JSXAttribute") {
			const name = nameOf(get(n, "name"));
			if (owner === undefined) owner = name;
			if (name && /^(?:className|class)$/.test(name)) classCtx = true;
			if (name && TEXT_PROPS.has(name)) isText = true;
			break;
		}
		if (n.type === "JSXExpressionContainer" && direct) isText = true; // {"text"} as a child
		if (n.type === "Property") {
			const key = nameOf(get(n, "key")) ?? "";
			if (direct) owner = key;
			if (CLASS_NAME.test(key)) classCtx = true;
		}
		if (
			n.type === "VariableDeclarator" &&
			CLASS_NAME.test(nameOf(get(n, "id")) ?? "")
		)
			classCtx = true;
		if (n.type === "CallExpression") {
			const callee = get(n, "callee");
			const fn = nameOf(callee);
			if (callee?.type === "Identifier" && CLASS_FNS.has(fn ?? ""))
				classCtx = true;
			if (callee?.type === "Identifier" && fn === "toast") isText = true;
			if (callee?.type === "MemberExpression") {
				const obj = nameOf(get(callee, "object"));
				const prop = nameOf(get(callee, "property")) ?? "";
				if (obj === "console") isConsole = true;
				if (obj === "toast" && TOAST.has(prop)) isText = true;
			}
		}
		if (/Function|Program/.test(n.type)) break;
	}
	if (owner && TEXT_PROPS.has(owner)) isText = true;
	return { classCtx, owner, console: isConsole, isText };
}

// ---- TS/TSX ----------------------------------------------------------------

const BANNED_ICON =
	/^(?:Icon)?(?:Sparkles?|SparklesIcon|WandSparkles|Wand2?|WandIcon|MagicWand|Stars|StarsIcon)(?:Icon)?$/;
const ICON_SOURCES = new Set(["lucide-react", "@tabler/icons-react"]);
const PRIMITIVE = new Map(REGISTRY.map((p) => [p.file, p]));
const CURRENCY_TAIL = /(?:[$€£¥₹₽₩₺₴₦₱₫฿]|\bR\$|\bUS\$|\bAR\$)\s?$/;
const RAW_TAGS = new Set(["button", "select", "table", "textarea"]);
const STYLE_DURATION_KEYS = new Set([
	"transition",
	"transitionDuration",
	"animation",
	"animationDuration",
]);

function staticString(n: Node | undefined): string | undefined {
	if (!n) return undefined;
	if (n.type === "Literal" && typeof n.value === "string") return n.value;
	if (n.type === "JSXExpressionContainer")
		return staticString(get(n, "expression"));
	if (n.type === "TemplateLiteral") {
		const q = n.quasis as Node[];
		if (q.length === 1) return cooked(q[0]);
	}
	return undefined;
}

function attr(el: Node, name: string): Node | undefined {
	for (const a of (el.attributes as Node[]) ?? []) {
		if (a.type === "JSXAttribute" && nameOf(get(a, "name")) === name) return a;
	}
	return undefined;
}

function hasSpread(el: Node): boolean {
	return ((el.attributes as Node[]) ?? []).some(
		(a) => a.type === "JSXSpreadAttribute",
	);
}

/** Visible text or an sr-only label anywhere inside a JSX element. */
function hasLabel(el: Node): boolean {
	let found = false;
	const root: Node = {
		type: "Children",
		start: el.start,
		end: el.end,
		children: el.children,
	};
	walk(root, [], (n) => {
		if (n.type === "JSXText" && (str(n, "value") ?? "").trim()) found = true;
		if (
			n.type === "JSXExpressionContainer" &&
			get(n, "expression") &&
			get(n, "expression")?.type !== "JSXEmptyExpression"
		) {
			const e = get(n, "expression");
			if (
				e &&
				(e.type === "Literal" ||
					e.type === "TemplateLiteral" ||
					e.type === "Identifier" ||
					e.type === "CallExpression" ||
					e.type === "MemberExpression")
			)
				found = true;
		}
		if (
			n.type === "JSXAttribute" &&
			nameOf(get(n, "name")) === "className" &&
			/\bsr-only\b/.test(staticString(get(n, "value")) ?? "")
		)
			found = true;
	});
	return found;
}

function scanTs(file: string, text: string, out: Raw[]) {
	const lang = file.endsWith(".tsx") ? "tsx" : "ts";
	const parsed = parseSync(file, text, { lang });
	const program = parsed.program as unknown as Node;
	const starts = lineStarts(text);
	const line = (i: number) => lineOf(starts, i);

	walk(program, [], (n, stack) => {
		const parent = stack[stack.length - 1];
		switch (n.type) {
			case "Literal": {
				if (typeof n.value !== "string") break;
				if (parent && /Import|Export/.test(parent.type)) break;
				if (
					parent?.type === "TSLiteralType" ||
					parent?.type === "TSExternalModuleReference"
				)
					break;
				runTokenRules(
					{ text: n.value, start: n.start, ...context(stack) },
					line,
					out,
				);
				break;
			}
			case "TemplateElement": {
				const text = cooked(n) ?? "";
				runTokenRules({ text, start: n.start, ...context(stack) }, line, out);
				break;
			}
			case "JSXText": {
				const v = str(n, "value") ?? "";
				if (v.trim())
					copyRules(
						v,
						line(n.start + (v.length - v.trimStart().length)),
						out,
						false,
						true,
					);
				break;
			}
			case "ImportDeclaration": {
				const src = str(get(n, "source"), "value") ?? "";
				if (ICON_SOURCES.has(src)) {
					if (src === "@tabler/icons-react")
						out.push({ rule: "UI-034", line: line(n.start), match: src });
					for (const s of (n.specifiers as Node[]) ?? []) {
						const imported =
							nameOf(get(s, "imported")) ?? nameOf(get(s, "local"));
						if (imported && BANNED_ICON.test(imported))
							out.push({
								rule: "UI-033",
								line: line(s.start),
								match: imported,
							});
					}
				}
				const ui =
					/^(?:~\/components\/ui\/|\.\.?\/(?:components\/)?ui\/)([\w-]+)$/.exec(
						src,
					);
				const p = ui ? PRIMITIVE.get(ui[1] ?? "") : undefined;
				if (p && p.status !== "core")
					out.push({
						rule: "UI-041",
						line: line(n.start),
						match: `${p.file} (${p.status})`,
					});
				break;
			}
			case "JSXOpeningElement": {
				const tag = nameOf(get(n, "name")) ?? "";
				if (RAW_TAGS.has(tag))
					out.push({ rule: "UI-042", line: line(n.start), match: `<${tag}>` });
				if (tag === "input") {
					const type = staticString(get(attr(n, "type"), "value"));
					if (type !== "hidden" && type !== "file")
						out.push({
							rule: "UI-042",
							line: line(n.start),
							match: `<input type="${type ?? "text"}">`,
						});
				}
				// UI-131 icon-only buttons
				if (/Button$/.test(tag)) {
					const size = staticString(get(attr(n, "size"), "value"));
					const named =
						attr(n, "aria-label") ||
						attr(n, "aria-labelledby") ||
						attr(n, "title") ||
						hasSpread(n);
					if (
						size?.startsWith("icon") &&
						!named &&
						parent &&
						!hasLabel(parent)
					) {
						out.push({
							rule: "UI-131",
							line: line(n.start),
							match: `<${tag} size="${size}">`,
						});
					}
				}
				// style={{ ... }}
				const style = get(get(attr(n, "style"), "value"), "expression");
				if (style?.type === "ObjectExpression") {
					for (const p of (style.properties as Node[]) ?? []) {
						if (p.type !== "Property") continue;
						const key = nameOf(get(p, "key")) ?? "";
						const value = get(p, "value");
						if (key === "fontSize") {
							const raw = value?.type === "Literal" ? value.value : undefined;
							if (
								typeof raw === "number" ||
								(typeof raw === "string" && /^[\d.]+(?:px|rem|em)$/.test(raw))
							) {
								out.push({
									rule: "UI-010",
									line: line(p.start),
									match: `fontSize: ${String(raw)}`,
								});
							}
						} else if (key === "fontWeight") {
							const raw =
								value?.type === "Literal" ? Number(value.value) : Number.NaN;
							if (raw >= 700 || raw <= 300)
								out.push({
									rule: "UI-011",
									line: line(p.start),
									match: `fontWeight: ${raw}`,
								});
						} else if (key === "boxShadow" || key === "textShadow") {
							out.push({ rule: "UI-031", line: line(p.start), match: key });
						} else if (
							key === "textTransform" &&
							staticString(value) === "uppercase"
						) {
							out.push({
								rule: "UI-012",
								line: line(p.start),
								match: "textTransform: uppercase",
							});
						} else if (STYLE_DURATION_KEYS.has(key)) {
							const s = staticString(value);
							if (s)
								for (const d of badDurations(s))
									out.push({
										rule: "UI-100",
										line: line(p.start),
										match: `${key}: ${d}`,
									});
						}
					}
				}
				break;
			}
			case "JSXElement": {
				// UI-071: <span>${amount}</span>
				const ch = (n.children as Node[]) ?? [];
				for (let i = 0; i + 1 < ch.length; i++) {
					const a = ch[i] as Node;
					const b = ch[i + 1] as Node;
					if (
						a.type === "JSXText" &&
						CURRENCY_TAIL.test(str(a, "value") ?? "") &&
						b.type === "JSXExpressionContainer"
					) {
						out.push({
							rule: "UI-071",
							line: line(a.end - 1),
							match: `${(str(a, "value") ?? "").trim()}{…}`,
						});
					}
				}
				break;
			}
			case "TemplateLiteral": {
				const q = (n.quasis as Node[]) ?? [];
				const exprs = (n.expressions as Node[]) ?? [];
				for (let i = 0; i < exprs.length; i++) {
					const part = cooked(q[i]) ?? "";
					if (CURRENCY_TAIL.test(part))
						out.push({
							rule: "UI-071",
							line: line(n.start),
							match: `\`${part.slice(-4)}\${…}\``,
						});
				}
				break;
			}
			case "BinaryExpression": {
				if (n.operator !== "+") break;
				const left = get(n, "left");
				const right = get(n, "right");
				const ls = staticString(left);
				if (
					ls !== undefined &&
					CURRENCY_TAIL.test(ls) &&
					right &&
					staticString(right) === undefined
				) {
					out.push({
						rule: "UI-071",
						line: line(n.start),
						match: `"${ls.slice(-4)}" + …`,
					});
				}
				break;
			}
			case "CallExpression": {
				const callee = get(n, "callee");
				if (callee?.type === "MemberExpression") {
					const prop = nameOf(get(callee, "property")) ?? "";
					if (
						/^(?:toLocaleString|toLocaleDateString|toLocaleTimeString|toFixed)$/.test(
							prop,
						)
					) {
						out.push({
							rule: "UI-070",
							line: line(n.start),
							match: `.${prop}()`,
						});
					}
				}
				break;
			}
			case "MemberExpression": {
				if (
					nameOf(get(n, "object")) === "Intl" &&
					get(n, "object")?.type === "Identifier"
				) {
					const prop = nameOf(get(n, "property")) ?? "";
					if (
						/^(?:NumberFormat|DateTimeFormat|RelativeTimeFormat)$/.test(prop)
					) {
						out.push({
							rule: "UI-070",
							line: line(n.start),
							match: `Intl.${prop}`,
						});
					}
				}
				break;
			}
		}
	});
}

// ---- CSS -------------------------------------------------------------------

/** Blank comments, keeping newlines so line numbers stay right. */
function stripCssComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

function scanCss(file: string, text: string, out: Raw[]) {
	const css = stripCssComments(text);
	const starts = lineStarts(css);
	const line = (i: number) => lineOf(starts, i);
	const theme = THEME_FILES.has(file);
	// Declarations: `prop: value;` inside blocks (selectors never match).
	const decl = /(?:^|[{;\s])(--?[\w-]+|[a-z-]+)\s*:\s*([^;{}]*)/g;
	for (let m = decl.exec(css); m; m = decl.exec(css)) {
		const prop = m[1] ?? "";
		const value = m[2] ?? "";
		const at = m.index + m[0].indexOf(prop);
		const isCustom = prop.startsWith("--");
		// A selector that looks like a declaration (`a:hover {`, `@media (x: y) {`) ends at a brace.
		const after = css.charAt(m.index + m[0].length);
		if (after === "{") continue;
		if (!(isCustom && theme)) {
			for (const re of [HEX, COLOR_FN]) {
				const g = new RegExp(re.source, re.flags);
				for (let c = g.exec(value); c; c = g.exec(value))
					out.push({ rule: "UI-001", line: line(at), match: c[0] });
			}
		}
		if (prop === "font-size" && /\d/.test(value) && !/var\(/.test(value)) {
			const px = /([\d.]+)px/.exec(value);
			if (px && !["12", "13", "14", "16", "22", "32"].includes(px[1] ?? ""))
				out.push({
					rule: "UI-010",
					line: line(at),
					match: `font-size: ${value.trim()}`,
				});
		}
		if (
			prop === "font-weight" &&
			/^(?:[789]00|bold|bolder|[123]00|lighter)$/.test(value.trim())
		) {
			out.push({
				rule: "UI-011",
				line: line(at),
				match: `font-weight: ${value.trim()}`,
			});
		}
		if (prop === "text-transform" && /uppercase/.test(value))
			out.push({
				rule: "UI-012",
				line: line(at),
				match: "text-transform: uppercase",
			});
		if (
			prop === "letter-spacing" &&
			/^0?\.\d+em|^[1-9]/.test(value.trim()) &&
			!/var\(/.test(value)
		) {
			out.push({
				rule: "UI-012",
				line: line(at),
				match: `letter-spacing: ${value.trim()}`,
			});
		}
		if (/gradient\(/.test(value))
			out.push({
				rule: "UI-030",
				line: line(at),
				match: `${prop}: …gradient(`,
			});
		if (
			(prop === "box-shadow" || prop === "text-shadow") &&
			!/^\s*(?:none|var\(--elev-)/.test(value)
		) {
			out.push({ rule: "UI-031", line: line(at), match: prop });
		}
		if (
			/^border-(?:left|right|top|bottom|inline-start|inline-end|block-start|block-end)(?:-width)?$/.test(
				prop,
			)
		) {
			const w = /([\d.]+)px/.exec(value);
			if (w && Number(w[1]) >= 2)
				out.push({
					rule: "UI-032",
					line: line(at),
					match: `${prop}: ${value.trim()}`,
				});
		}
		if (
			/^(?:transition|transition-duration|animation|animation-duration|--animate-[\w-]+)$/.test(
				prop,
			)
		) {
			for (const d of badDurations(value))
				out.push({ rule: "UI-100", line: line(at), match: `${prop}: ${d}` });
		}
		for (const s of overshoots(value))
			out.push({ rule: "UI-101", line: line(at), match: s });
	}
	// UI-130: `sel { outline: none }` whose selector has no :focus-visible
	const block = /([^{}]*)\{([^{}]*)\}/g;
	for (let b = block.exec(css); b; b = block.exec(css)) {
		const d = /(?<![\w-])outline(?:-style)?\s*:\s*none\b/.exec(b[2] ?? "");
		if (!d || /:focus-visible/.test(b[1] ?? "")) continue;
		out.push({
			rule: "UI-130",
			line: line(b.index + (b[1] ?? "").length + 1 + d.index),
			match: d[0],
		});
	}
}

// ---- messages ----------------------------------------------------------------

function scanMessages(file: string, text: string, out: Raw[]) {
	const english = file === "messages/en.json";
	const lines = text.split("\n");
	lines.forEach((l, i) => {
		const m = /^\s*"(?:[^"\\]|\\.)*"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(l);
		if (m) copyRules(m[1] ?? "", i + 1, out, false, english);
	});
}

// ---- public ----------------------------------------------------------------

export function scanFile(file: string, text: string): Hit[] {
	if (!inScope(file)) return [];
	const raw: Raw[] = [];
	if (file.endsWith(".json")) scanMessages(file, text, raw);
	else if (file.endsWith(".css")) scanCss(file, text, raw);
	else scanTs(file, text, raw);
	return raw
		.filter((h) => applies(h.rule, file))
		.map((h) => ({ ...h, file, message: RULES[h.rule] ?? h.rule }))
		.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}
