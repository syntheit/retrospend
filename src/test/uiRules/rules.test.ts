// Unit tests for every rule: it hits a bad snippet and stays quiet on a good
// one, on a comment that mentions the pattern, and on an exempt path.
import { describe, expect, it } from "vitest";
import { inScope, scanFile } from "./rules";

const TSX = "src/components/thing.tsx";
const CSS = "src/styles/other.css";

const count = (rule: string, code: string, file = TSX) =>
	scanFile(file, code).filter((h) => h.rule === rule).length;
const hit = (rule: string, code: string, file = TSX) =>
	expect(
		count(rule, code, file),
		`${rule} should hit: ${code}`,
	).toBeGreaterThan(0);
const miss = (rule: string, code: string, file = TSX) =>
	expect(count(rule, code, file), `${rule} should not hit: ${code}`).toBe(0);
/** U+2014 (the em dash), built at runtime so this file contains none. */
const EM = String.fromCharCode(0x2014);
const cls = (c: string) => `export const A = () => <div className="${c}" />;`;

describe("scope", () => {
	it("skips tests, src/test and declaration files; covers messages", () => {
		expect(inScope("src/lib/a.test.ts")).toBe(false);
		expect(inScope("src/hooks/__tests__/x.ts")).toBe(false);
		expect(inScope("src/test/uiRules/rules.ts")).toBe(false);
		expect(inScope("src/types/x.d.ts")).toBe(false);
		expect(inScope("src/lib/a.ts")).toBe(true);
		expect(inScope("packages/i18n/messages/en.json")).toBe(true);
		expect(inScope("packages/i18n/messages/en/budget.json")).toBe(true);
		expect(inScope("docs/ui/design.json")).toBe(false);
	});
	it("throws with the file path on a parse error", () => {
		expect(() => scanFile(TSX, "export const A = () => <div>{ broken")).toThrow(
			TSX,
		);
	});
	it("runs style rules only on UI code, copy rules everywhere", () => {
		miss("UI-002", `export const c = "text-red-500";`, "src/server/x.ts");
		hit("UI-120", `export const c = "a ${EM} b";`, "src/server/x.ts");
	});
});

describe("colors", () => {
	it("UI-001 raw color literals", () => {
		hit("UI-001", `export const c = "#ff0000";`);
		hit("UI-001", `export const c = "rgba(0,0,0,.5)";`);
		hit("UI-001", `export const c = "oklch(0.5 0.1 20)";`);
		hit("UI-001", ".a { color: hsl(10 20% 30%); }", CSS);
		hit("UI-001", ".a { color: #fff; }", "src/styles/globals.css");
		miss("UI-001", ":root { --x: #fff; }", "src/styles/globals.css");
		miss(
			"UI-001",
			":root { --x: oklch(0.5 0.1 20); }",
			"src/styles/tokens.css",
		);
		miss("UI-001", `export const c = "var(--positive)";`);
		miss("UI-001", `// "#ff0000"\nexport const c = 1;`);
		miss("UI-001", `export const A = () => <a href="#add">x</a>;`);
		miss("UI-001", "#main { color: var(--fg); }", CSS);
	});
	it("UI-002 Tailwind palette colors", () => {
		hit("UI-002", cls("text-emerald-600"));
		hit("UI-002", cls("dark:bg-blue-500/10"));
		hit("UI-002", cls("bg-white"));
		hit("UI-002", `const MAP = { red: "bg-red-500 text-red-50" };`);
		miss("UI-002", cls("text-positive bg-surface border-line"));
		miss("UI-002", `export const msg = "the red pen";`);
	});
});

describe("type", () => {
	it("UI-010 font sizes", () => {
		hit("UI-010", cls("text-2xl"));
		hit("UI-010", cls("text-[10px]"));
		hit("UI-010", `export const A = () => <p style={{ fontSize: 11 }} />;`);
		hit("UI-010", ".a { font-size: 10px; }", CSS);
		miss("UI-010", cls("text-sm text-meta text-title text-hero"));
		miss("UI-010", ".a { font-size: 14px; }", CSS);
	});
	it("UI-010 rem and em font sizes in CSS", () => {
		hit("UI-010", ".a { font-size: 0.625rem; }", CSS);
		hit("UI-010", ".a { font-size: 1.25rem; }", CSS);
		hit("UI-010", ".a { font-size: 0.9em; }", CSS);
		miss("UI-010", ".a { font-size: 0.875rem; }", CSS);
		miss("UI-010", ".a { font-size: 1rem; }", CSS);
		miss("UI-010", ".a { font-size: 1em; }", CSS);
	});
	it("CSS @apply runs the class rules", () => {
		hit("UI-002", ".a { @apply bg-white text-sm; }", CSS);
		hit("UI-010", ".a { @apply text-2xl; }", CSS);
		hit("UI-021", ".a {\n  @apply rounded-md;\n}", CSS);
		hit("UI-001", ".a { @apply dark:bg-[#fff]; }", CSS);
		expect(
			scanFile(CSS, ".a { @apply dark:bg-[#fff]; }").filter(
				(h) => h.rule === "UI-001",
			).length,
		).toBe(1);
		miss("UI-002", ".a { @apply bg-surface text-fg; }", CSS);
	});
	it("UI-011 weights", () => {
		hit("UI-011", cls("font-bold"));
		hit("UI-011", `export const A = () => <p style={{ fontWeight: 700 }} />;`);
		miss("UI-011", cls("font-semibold font-medium"));
	});
	it("UI-012 eyebrows", () => {
		hit("UI-012", cls("text-xs uppercase"));
		hit("UI-012", cls("tracking-wider"));
		hit("UI-012", ".a { text-transform: uppercase; }", CSS);
		miss("UI-012", `export const msg = "use uppercase letters";`);
		miss("UI-012", cls("tracking-tight"));
	});
});

describe("space and shape", () => {
	it("UI-020 spacing scale", () => {
		hit("UI-020", cls("gap-1.5"));
		hit("UI-020", cls("md:px-5"));
		hit("UI-020", cls("-mt-10"));
		hit("UI-020", cls("p-[7px]"));
		miss("UI-020", cls("p-2 gap-3 mx-auto mt-0.5 px-6 py-12"));
		miss(
			"UI-020",
			cls("pb-[calc(1rem+env(safe-area-inset-bottom))] px-(--gutter)"),
		);
		miss("UI-020", cls("top-5 w-10 size-5"));
	});
	it("UI-021 radius", () => {
		hit("UI-021", cls("rounded-md"));
		hit("UI-021", cls("rounded-t-2xl"));
		hit("UI-021", cls("rounded"));
		hit("UI-021", cls("rounded-[5px]"));
		miss(
			"UI-021",
			cls(
				"rounded-lg rounded-xl rounded-full rounded-ctl rounded-panel rounded-t-xl",
			),
		);
		miss("UI-021", `export const msg = "a rounded corner";`);
	});
});

describe("decoration (R31)", () => {
	it("UI-030 gradients", () => {
		hit("UI-030", cls("bg-gradient-to-br from-a to-b"));
		hit("UI-030", cls("bg-linear-to-r"));
		hit("UI-030", ".a { background: linear-gradient(red, blue); }", CSS);
		miss("UI-030", cls("bg-surface"));
	});
	it("UI-031 shadows, glows, blur", () => {
		hit("UI-031", cls("shadow-lg"));
		hit("UI-031", cls("rounded-xl shadow"));
		hit("UI-031", cls("shadow-[inset_0_0_20px_rgba(1,2,3,0.1)]"));
		hit("UI-031", cls("blur-3xl"));
		hit("UI-031", ".a { box-shadow: 0 0 4px red; }", CSS);
		hit(
			"UI-031",
			`export const A = () => <p style={{ boxShadow: "0 0 2px" }} />;`,
		);
		miss("UI-031", cls("shadow-menu shadow-none backdrop-blur-md"));
		miss("UI-031", ".a { box-shadow: var(--elev-menu); }", CSS);
		miss("UI-031", `export const msg = "in the shadow of";`);
	});
	it("UI-032 accent stripes", () => {
		hit("UI-032", cls("border-l-4 border-l-amber-500"));
		hit("UI-032", cls("border-t-2"));
		hit("UI-032", cls("border-l-primary"));
		hit("UI-032", ".a { border-left: 3px solid var(--brand); }", CSS);
		miss("UI-032", cls("border-t border-b-line border-l-0 border"));
	});
	it("UI-033 sparkle icons", () => {
		hit("UI-033", `import { Sparkles } from "lucide-react";`);
		hit("UI-033", `import { WandSparkles as W } from "lucide-react";`);
		hit("UI-033", `import { IconSparkles } from "@tabler/icons-react";`);
		miss("UI-033", `import { Star, Banknote } from "lucide-react";`);
	});
	it("UI-034 one icon set", () => {
		hit("UI-034", `import { IconHome } from "@tabler/icons-react";`);
		miss("UI-034", `import { House } from "lucide-react";`);
	});
	it("UI-035 emoji", () => {
		hit("UI-035", `export const A = () => <p>Done 🎉</p>;`);
		hit("UI-035", `{\n  "a": "Nice 🚀"\n}`, "packages/i18n/messages/en.json");
		miss("UI-035", `export const A = () => <p>© 2026 Retrospend ™</p>;`);
	});
});

describe("components", () => {
	it("UI-041 legacy and internal primitives", () => {
		hit("UI-041", `import { Card } from "~/components/ui/card";`);
		hit("UI-041", `import { Dialog } from "~/components/ui/dialog";`);
		miss("UI-041", `import { Button } from "~/components/ui/button";`);
		miss(
			"UI-041",
			`import { Dialog } from "~/components/ui/dialog";`,
			"src/components/ui/responsive-dialog.tsx",
		);
	});
	it("UI-041 sees re-exports, dynamic imports and deep relative paths", () => {
		hit("UI-041", `export { Card } from "~/components/ui/card";`);
		hit("UI-041", `export * from "~/components/ui/dialog";`);
		hit("UI-041", `export const L = () => import("~/components/ui/card");`);
		hit(
			"UI-041",
			`import { Card } from "../../../components/ui/card";`,
			"src/app/(dashboard)/x/page.tsx",
		);
		hit(
			"UI-041",
			`import { Sheet } from "../ui/sheet";`,
			"src/components/people/x.tsx",
		);
		miss("UI-041", `export { Button } from "~/components/ui/button";`);
		miss(
			"UI-041",
			`import { Card } from "../ui/card";`,
			"src/app/(dashboard)/x/page.tsx",
		);
	});
	it("UI-042 raw elements", () => {
		hit("UI-042", `export const A = () => <button onClick={f}>x</button>;`);
		hit("UI-042", `export const A = () => <input type="checkbox" />;`);
		hit("UI-042", `export const A = () => <select />;`);
		miss("UI-042", `export const A = () => <input type="file" hidden />;`);
		miss("UI-042", `export const A = () => <Button>x</Button>;`);
		miss(
			"UI-042",
			`export const A = () => <button>x</button>;`,
			"src/components/ui/button.tsx",
		);
	});
});

describe("money", () => {
	it("UI-070 formatters only", () => {
		hit("UI-070", `export const s = (n: number) => n.toFixed(2);`);
		hit("UI-070", `export const s = (d: Date) => d.toLocaleDateString();`);
		hit("UI-070", `export const f = new Intl.NumberFormat("en-US");`);
		miss("UI-070", `// n.toFixed(2)\nexport const x = 1;`);
	});
	it("UI-070 applies everywhere but the services (IMPLEMENTATION §4)", () => {
		const fixed = `export const s = (n: number) => n.toFixed(2);`;
		hit("UI-070", fixed, "src/lib/currency-format.ts");
		hit("UI-070", fixed, "src/server/api/routers/x.ts");
		hit("UI-070", fixed, "src/server/exchange-rates.ts");
		miss("UI-070", fixed, "src/server/services/x.service.ts");
		hit(
			"UI-070",
			`export const f = new Intl.NumberFormat("en-US");`,
			"src/lib/date-locale.ts",
		);
		miss(
			"UI-070",
			`export const s = (d: Date) => d.toLocaleDateString();`,
			"src/lib/date-locale.ts",
		);
	});
	it("UI-071 hand-built money strings", () => {
		hit("UI-071", "export const s = (x: number) => `$${x}`;");
		hit("UI-071", `export const s = (x: string) => "€" + x;`);
		hit(
			"UI-071",
			`export const A = ({ x }: { x: string }) => <span>\${x}</span>;`,
		);
		miss("UI-071", "export const s = (x: string) => `${x} items`;");
		miss(
			"UI-071",
			`export const A = ({ x }: { x: string }) => <span>{x}</span>;`,
		);
	});
	it("UI-071 symbol after the amount", () => {
		hit("UI-071", "export const s = (a: number) => `${a} €`;");
		hit("UI-071", "export const s = (a: number) => `${a}€`;");
		hit(
			"UI-071",
			`export const A = ({ a }: { a: string }) => <span>{a} €</span>;`,
		);
		hit("UI-071", `export const s = (a: string) => a + " €";`);
		miss("UI-071", "export const r = (x: string) => new RegExp(`^${x}$`);");
		miss("UI-071", "export const s = (a: number) => `${a} items`;");
	});
});

describe("motion", () => {
	it("UI-100 durations", () => {
		hit("UI-100", cls("transition duration-300"));
		hit("UI-100", cls("duration-[250ms]"));
		hit("UI-100", ".a { transition: opacity 300ms ease; }", CSS);
		hit(
			"UI-100",
			`export const A = () => <p style={{ transition: "opacity 0.3s" }} />;`,
		);
		miss("UI-100", cls("transition duration-120 duration-(--t-state)"));
		miss("UI-100", ".a { transition-duration: 0.01ms; }", CSS);
		miss("UI-100", `export const msg = "Retry in 30s";`);
	});
	it("UI-101 bounce", () => {
		hit(
			"UI-101",
			".a { animation: pop 160ms cubic-bezier(0.34, 1.56, 0.64, 1); }",
			CSS,
		);
		hit("UI-101", cls("animate-bounce"));
		miss(
			"UI-101",
			".a { transition: opacity 160ms cubic-bezier(0.22, 1, 0.36, 1); }",
			CSS,
		);
	});
});

describe("wording", () => {
	it("UI-120 em dashes", () => {
		hit("UI-120", `export const A = () => <p>Paid ${EM} thanks</p>;`);
		hit("UI-120", `export const s = "a ${EM} b";`);
		hit("UI-120", `{\n  "a": "x ${EM} y"\n}`, "packages/i18n/messages/es.json");
		miss("UI-120", `// a ${EM} b\nexport const s = "a, b";`);
		miss("UI-120", `console.log("debug ${EM} x");`);
	});
	it("UI-120 HTML entities for the em dash", () => {
		hit("UI-120", `export const A = () => <p>Paid &mdash; thanks</p>;`);
		hit("UI-120", `export const A = () => <p>Paid &#8212; thanks</p>;`);
		hit("UI-120", `export const A = () => <p title="a &mdash; b" />;`);
		miss("UI-120", `export const A = () => <p>Paid &ndash; thanks</p>;`);
	});
	it("UI-121 glossary", () => {
		hit(
			"UI-121",
			`{\n  "a": "Log in to continue"\n}`,
			"packages/i18n/messages/en.json",
		);
		hit(
			"UI-121",
			`{\n  "a": "Log in to continue"\n}`,
			"packages/i18n/messages/en/budget.json",
		);
		hit("UI-121", `export const A = () => <p>Add a participant</p>;`);
		hit(
			"UI-121",
			`export const A = () => <Input placeholder="Search participants" />;`,
		);
		miss(
			"UI-121",
			`{\n  "a": "Iniciar sesión, participante"\n}`,
			"packages/i18n/messages/es.json",
		);
		miss("UI-121", `export const ROUTE = "/login";`);
	});
	it("UI-121 ignores translation keys", () => {
		miss(
			"UI-121",
			`export const A = () => { const t = useTranslations("x"); return <Input placeholder={t("receivable")} />; };`,
		);
		miss(
			"UI-121",
			`export const A = () => { const tPeople = useTranslations("participants"); return <p title={tPeople("participant")} />; };`,
		);
		miss("UI-121", `export const A = () => <p>{t.rich("login", {})}</p>;`);
		hit(
			"UI-121",
			`export const A = () => <p title={t("x", { who: "a participant" })} />;`,
		);
	});
});

describe("accessibility", () => {
	it("UI-130 focus outline", () => {
		hit("UI-130", cls("outline-none"));
		hit("UI-130", ".a:focus { outline: none; }", CSS);
		miss("UI-130", cls("outline-none focus-visible:ring-2"));
		miss(
			"UI-130",
			".a:focus-visible { outline: none; box-shadow: var(--elev-ctl); }",
			CSS,
		);
	});
	it("UI-130 focus-visible removals and empty replacements", () => {
		hit("UI-130", cls("focus-visible:outline-none"));
		hit("UI-130", cls("outline-none focus-visible:ring-0"));
		hit("UI-130", cls("outline-none focus-visible:ring-offset-2"));
		miss("UI-130", cls("focus-visible:outline-none focus-visible:ring-2"));
		miss("UI-130", cls("outline-none focus-visible:ring-[3px]"));
	});
	it("UI-131 icon-only buttons", () => {
		hit("UI-131", `export const A = () => <Button size="icon"><X /></Button>;`);
		miss(
			"UI-131",
			`export const A = () => <Button size="icon" aria-label="Close"><X /></Button>;`,
		);
		miss(
			"UI-131",
			`export const A = () => <Button size="icon"><X /><span className="sr-only">Close</span></Button>;`,
		);
		miss(
			"UI-131",
			`export const A = () => <Button size="icon" onClick={go}>{t("close")}</Button>;`,
		);
	});
	it("UI-131 icon-only buttons of any size", () => {
		const head = `import { Trash2, X } from "lucide-react";\n`;
		hit(
			"UI-131",
			`${head}export const A = () => <Button variant="ghost"><Trash2 /></Button>;`,
		);
		hit(
			"UI-131",
			`${head}export const A = () => <Button><X className="size-4" /></Button>;`,
		);
		hit("UI-131", `export const A = () => <Button><CloseIcon /></Button>;`);
		hit(
			"UI-131",
			`${head}export const A = () => <button type="button"><X /></button>;`,
		);
		hit(
			"UI-131",
			`${head}export const A = () => <Button asChild><Link href="/"><X /></Link></Button>;`,
		);
		miss(
			"UI-131",
			`${head}export const A = () => <Button><Trash2 />Delete</Button>;`,
		);
		miss(
			"UI-131",
			`${head}export const A = () => <Button><X />{t("close")}</Button>;`,
		);
		miss(
			"UI-131",
			`${head}export const A = () => <Button><X /><span className="sr-only">{t("close")}</span></Button>;`,
		);
		miss(
			"UI-131",
			`${head}export const A = () => <Button aria-label={t("close")}><X /></Button>;`,
		);
		miss(
			"UI-131",
			`${head}export const A = () => <Button asChild><Link aria-label={t("home")} href="/"><X /></Link></Button>;`,
		);
		miss("UI-131", `export const A = () => <Button>{label}</Button>;`);
	});
});

describe("copy in code (UI-124)", () => {
	it("hits literal English in JSX children and text props", () => {
		hit("UI-124", `export const A = () => <p>Add expense</p>;`);
		hit(
			"UI-124",
			`export const A = () => <Input placeholder="Search people" />;`,
		);
		hit("UI-124", `export const A = () => <Button aria-label="Close" />;`);
		hit("UI-124", `export const A = () => <p title="Settings" />;`);
		hit("UI-124", `export const A = () => <p>{"Save"}</p>;`);
		hit(
			"UI-124",
			`export const A = ({ ok }: { ok: boolean }) => <p>{ok ? "Yes" : "No"}</p>;`,
		);
		hit(
			"UI-124",
			"export const A = ({ n }: { n: string }) => <p aria-label={`Remove ${n}`} />;",
		);
	});
	it("ignores t(), symbols, codes, code samples and class names", () => {
		miss("UI-124", `export const A = () => <p>{t("save")}</p>;`);
		miss(
			"UI-124",
			`export const A = () => <Input placeholder={t("search")} />;`,
		);
		miss("UI-124", `export const A = () => <p>· / %</p>;`);
		miss(
			"UI-124",
			`export const A = ({ a, b }: { a: number; b: number }) => <p>{a} / {b}</p>;`,
		);
		miss("UI-124", `export const A = () => <p>USD</p>;`);
		miss("UI-124", `export const A = () => <p>&middot; &nbsp;</p>;`);
		miss("UI-124", `export const A = () => <p>Retrospend</p>;`);
		miss("UI-124", `export const A = () => <code>pnpm dev</code>;`);
		miss("UI-124", `export const A = () => <p className="text-sm text-fg" />;`);
		miss("UI-124", `export const A = () => <a href="/settings">{t("go")}</a>;`);
		miss("UI-124", `export const msg = "Saved";`);
		miss(
			"UI-124",
			`export const A = () => <p>Add expense</p>;`,
			"src/server/x.tsx",
		);
	});
});

describe("code shape", () => {
	const lines = (n: number) =>
		Array.from({ length: n }, (_, i) => `export const a${i} = ${i};`).join(
			"\n",
		);
	const size = (file: string, n: number) =>
		scanFile(file, lines(n))
			.filter((h) => h.rule === "UI-150")
			.reduce((a, h) => a + (h.count ?? 1), 0);
	it("UI-150 counts lines over the limit for components, services and routers", () => {
		expect(size("src/components/x.tsx", 300)).toBe(0);
		expect(size("src/components/x.tsx", 301)).toBe(1);
		expect(size("src/app/(dashboard)/x/page.tsx", 340)).toBe(40);
		expect(size("src/server/services/x.service.ts", 500)).toBe(0);
		expect(size("src/server/services/x.service.ts", 520)).toBe(20);
		expect(size("src/server/api/routers/x.ts", 310)).toBe(10);
		expect(size("src/lib/x.ts", 900)).toBe(0);
	});
	it("UI-151 no database import in transport files", () => {
		const db = `import { db } from "~/server/db";\nexport const x = db;`;
		hit("UI-151", db, "src/server/api/routers/x.ts");
		hit("UI-151", db, "src/app/api/x/route.ts");
		hit(
			"UI-151",
			`import { db } from "../../db";\nexport const x = db;`,
			"src/server/api/routers/x.ts",
		);
		hit(
			"UI-151",
			`export const x = () => import("~/server/db");`,
			"src/server/api/trpc.ts",
		);
		miss("UI-151", db, "src/server/services/x.service.ts");
		miss(
			"UI-151",
			`import type { PrismaClient } from "~/server/db";\nexport type X = PrismaClient;`,
			"src/server/api/routers/x.ts",
		);
		miss(
			"UI-151",
			`import { list } from "~/server/services/x.service";\nexport const x = list;`,
			"src/server/api/routers/x.ts",
		);
	});
});
