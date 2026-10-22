"use client";

import { Money } from "~/components/money/money";
import { Face } from "~/components/ui/avatar-face";
import { m } from "../fixtures/rows";
import { Cap, Spec } from "../spec";
import { S } from "./foundations";

const COLORS: [string, string][] = [
	["bg", "bg-bg"],
	["surface", "bg-surface"],
	["raised", "bg-raised"],
	["line", "bg-line"],
	["line-strong", "bg-line-strong"],
	["fg", "bg-fg"],
	["fg-2", "bg-fg-2"],
	["fg-3", "bg-fg-3"],
	["brand", "bg-brand"],
	["accent", "bg-ds-accent"],
	["accent-strong", "bg-accent-strong"],
	["accent-soft", "bg-accent-soft"],
	["positive", "bg-positive"],
	["attention", "bg-attention"],
	["info", "bg-info"],
	["danger", "bg-danger"],
];
const SERIES = [
	"bg-series-1",
	"bg-series-2",
	"bg-series-3",
	"bg-series-4",
	"bg-series-5",
	"bg-series-6",
	"bg-series-7",
	"bg-series-8",
];
const CATEGORIES = [
	"bg-category-1",
	"bg-category-2",
	"bg-category-3",
	"bg-category-4",
	"bg-category-5",
	"bg-category-6",
	"bg-category-7",
	"bg-category-8",
	"bg-category-9",
	"bg-category-10",
	"bg-category-11",
	"bg-category-12",
	"bg-category-13",
	"bg-category-14",
	"bg-category-15",
	"bg-category-16",
	"bg-category-17",
	"bg-category-18",
	"bg-category-19",
	"bg-category-20",
	"bg-category-21",
];
const FACES = [
	"Sofía Ruiz",
	"Lucía Fernández",
	"Martín Acosta",
	"Paz Ibarra",
	"Juan Costa",
	"Tomás Herrera",
	"Nicolás Benítez",
	"Rocío Vega",
];
const TYPE: [string, string, string][] = [
	["hero 32 / 600", "text-hero font-semibold", ""],
	["page title 22 / 600", "text-title", "Activity"],
	["section 16 / 600", "text-section", "Needs you"],
	["body 14 / 400", "text-body", "Groceries at Super Norte"],
	["secondary 13 / 400", "text-small text-fg-2", "Split with Lucía and Martín"],
	["meta 12 / 400 (floor)", "text-meta text-fg-3", "Updated Oct 21"],
	[
		"mono, pasted strings only",
		"font-mono text-meta",
		"bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
	],
];

function Swatches({ items }: { items: [string, string][] }) {
	return (
		<div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
			{items.map(([name, cls]) => (
				<div className="text-fg-2 text-meta" key={name}>
					<i
						className={`rounded-ctl border-line mb-1 block h-8 border ${cls}`}
					/>
					{name}
				</div>
			))}
		</div>
	);
}

export function TokensSection() {
	return (
		<Spec id="tokens">
			<Cap>{S.colors}</Cap>
			<Swatches items={COLORS} />
			<Cap className="mt-4">{S.series}</Cap>
			<Swatches items={SERIES.map((c, i) => [`series-${i + 1}`, c])} />
			<Cap className="mt-4">{S.avatars}</Cap>
			<div className="flex flex-wrap gap-2">
				{FACES.map((n) => (
					<Face key={n} name={n} />
				))}
			</div>
			<Cap className="mt-4">{S.categories}</Cap>
			<Swatches items={CATEGORIES.map((c, i) => [`${i + 1}`, c])} />
			<Cap className="mt-4">{S.type}</Cap>
			<div>
				{TYPE.map(([k, cls, sample]) => (
					<div
						className="border-line flex items-baseline gap-4 border-t py-2"
						key={k}
					>
						<small className="text-fg-3 text-meta w-35 shrink-0">{k}</small>
						<span className={cls}>
							{sample || <Money value={m("2500650")} />}
						</span>
					</div>
				))}
			</div>
			<Cap className="mt-4">{S.scale}</Cap>
		</Spec>
	);
}
