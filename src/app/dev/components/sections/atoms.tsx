"use client";

import { Calendar } from "lucide-react";
import { type ReactNode, useState } from "react";
import { AvailablePill } from "~/components/money/available-pill";
import { Balance } from "~/components/money/balance";
import { Money } from "~/components/money/money";
import { CategoryGlyph } from "~/components/pickers/category-picker";
import { FilterChip, FilterChips, FilterMenu } from "~/components/ui/chip";
import { Segmented } from "~/components/ui/segmented";
import { StatusDot } from "~/components/ui/status-dot";
import { STATUS, type StatusKind } from "~/components/ui/status-map";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { CAT, m } from "../fixtures/rows";
import { Cap, Pair, Spec, States } from "../spec";

/** Sample labels inside the samples: fixtures, like the numbers. */
export const S = {
	ars7: "ARS, 7 digits",
	ars10: "ARS, 10 digits",
	usd: "USD",
	eur: "EUR, BRL (code)",
	jpy: "JPY, no minor units",
	btc: "BTC",
	eth: "ETH, tiny",
	neg: "Negative",
	zero: "Zero",
	pair: "Pair, foreign",
	missing: "Missing rate",
	unavailable: "Unavailable",
	owes: "Balance: owes you",
	owe: "you owe",
	settled: "settled",
	overall: "overall",
	funded: "Pill: funded",
	pzero: "zero",
	under: "underfunded",
	over: "overspent",
	view: "View",
	expenses: "Expenses",
	summary: "Summary",
	people: "People",
	oct: "Oct 2026",
	groceries: "Groceries",
	palermo: "Depto Palermo",
	disabled: "Disabled",
	upcoming: "Upcoming",
	overdue: "Overdue",
	paused: "Paused",
	segmented: "Segmented",
	chips:
		"FilterChips (toggle). Selected is filled brand. A category chip leads with its bare glyph.",
	tabs: "Tabs (panes inside one page; accent underline)",
	primary: "Primary",
	secondary: "Secondary",
	ghost: "Ghost",
	danger: "Danger",
	loading: "Loading",
	small: "Small",
	icon: "Icon",
	add: "Add expense",
	cancel: "Cancel",
	more: "More",
	delete: "Delete",
	record: "Record",
	confirm: "Confirm",
	saving: "Saving",
	input: "Input",
	error: "Error",
	title: "Title",
	locked: "Locked",
	switchOn: "Switch",
	checkbox: "Checkbox",
	rate: "USD 1 = ARS 1,412 · Official · Oct 21",
	tipPair: "Hover the pair",
	tipIcon: "Icon button",
	about: "About rates",
	filter: "Category",
};

export function MoneySection() {
	const kinds = Object.keys(STATUS) as StatusKind[];
	return (
		<Spec id="money">
			<States
				items={[
					[S.ars7, <Money key="a" value={m("1234567")} />],
					[S.ars10, <Money key="b" value={m("2500650123")} />],
					[S.usd, <Money key="c" value={m("1234.50", "USD")} />],
					[
						S.eur,
						<span className="flex gap-2" key="d">
							<Money value={m("48.20", "EUR")} />
							<Money value={m("8116.80", "BRL")} />
						</span>,
					],
					[S.jpy, <Money key="e" value={m("48000", "JPY")} />],
					[S.btc, <Money key="f" value={m("0.01834217", "BTC")} />],
					[S.eth, <Money key="g" value={m("0.0042", "ETH")} />],
					[S.neg, <Money key="h" value={m("-842600")} />],
					[S.zero, <Money key="i" value={m("0")} />],
					[
						S.pair,
						<Money.pair
							home={m("89529")}
							inline
							key="j"
							original={m("63.40", "USD")}
							tip={S.rate}
						/>,
					],
					[
						S.missing,
						<Money.pair
							home={null}
							inline
							key="k"
							original={m("63.40", "USD")}
						/>,
					],
					[S.unavailable, <Skeleton className="w-24" key="u" shape="money" />],
				]}
			/>
			<States
				className="mt-6"
				items={[
					[S.owes, <Balance amount={m("802352")} key="a" />],
					[S.owe, <Balance amount={m("-36200")} key="b" />],
					[S.settled, <Balance amount={m("0")} key="c" />],
					[
						S.overall,
						<Balance amount={m("1663643")} key="d" subject="people" />,
					],
				]}
			/>
			<States
				className="mt-6"
				items={[
					[
						S.funded,
						<AvailablePill amount={m("56800")} key="a" status="funded" />,
					],
					[S.pzero, <AvailablePill amount={m("0")} key="b" status="funded" />],
					[
						S.under,
						<AvailablePill amount={m("43200")} key="c" status="underfunded" />,
					],
					[
						S.over,
						<AvailablePill amount={m("48400")} key="d" status="overspent" />,
					],
				]}
			/>
			<States
				className="mt-6"
				items={kinds.map((k) => [k, <StatusDot key={k} kind={k} />])}
			/>
		</Spec>
	);
}

function Picks() {
	const [view, setView] = useState<"e" | "s" | "p">("e");
	const [on, setOn] = useState<Record<string, boolean>>({ oct: true });
	const chip = (id: string, label: string, lead?: ReactNode) => (
		<FilterChip
			lead={lead}
			onClick={() => setOn((o) => ({ ...o, [id]: !o[id] }))}
			selected={!!on[id]}
		>
			{label}
		</FilterChip>
	);
	return (
		<>
			<Cap>{S.segmented}</Cap>
			<Segmented
				label={S.view}
				onChange={setView}
				options={[
					{ value: "e", label: S.expenses },
					{ value: "s", label: S.summary },
					{ value: "p", label: S.people },
				]}
				value={view}
			/>
			<Cap className="mt-6">{S.chips}</Cap>
			<FilterChips>
				<FilterChip value>
					<Calendar />
					{S.oct}
				</FilterChip>
				{chip(
					"groceries",
					S.groceries,
					<CategoryGlyph category={{ id: "groceries", ...CAT.groceries }} />,
				)}
				{chip("palermo", S.palermo)}
				<FilterChip disabled>{S.disabled}</FilterChip>
				<FilterMenu
					groups={[
						{
							id: "c",
							label: S.filter,
							items: [{ id: "g", label: S.groceries, checked: !!on.groceries }],
						},
					]}
					onToggle={(_, id, c) =>
						setOn((o) => ({ ...o, groceries: id === "g" ? c : !!o.groceries }))
					}
				/>
			</FilterChips>
			<Cap className="mt-6">{S.tabs}</Cap>
			<Tabs defaultValue="u">
				<TabsList variant="line">
					<TabsTrigger count={9} value="u">
						{S.upcoming}
					</TabsTrigger>
					<TabsTrigger count={1} value="o">
						{S.overdue}
					</TabsTrigger>
					<TabsTrigger value="p">{S.paused}</TabsTrigger>
				</TabsList>
			</Tabs>
		</>
	);
}

export function PicksSection() {
	return (
		<Spec id="picks">
			<Pair desktop={<Picks />} phone={<Picks />} />
		</Spec>
	);
}
