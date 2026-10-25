"use client";

import { useState } from "react";
import { Money } from "~/components/money/money";
import { MoneyCell } from "~/components/money/money-cell";
import { MoneyInput, useMoneyText } from "~/components/money/money-input";
import {
	CategoryPicker,
	type PickerCategory,
} from "~/components/pickers/category-picker";
import { DatePicker } from "~/components/pickers/date-picker";
import {
	DateRange,
	type DateRangeValue,
} from "~/components/pickers/date-range";
import { DateRangePanel } from "~/components/pickers/date-range-panel";
import { PersonPicker } from "~/components/pickers/person-picker";
import {
	type PickerProject,
	ProjectPicker,
} from "~/components/pickers/project-picker";
import { CAT, TODAY } from "../fixtures/rows";
import { Cap, Pair, Spec, States } from "../spec";

/** Sample copy inside the samples: fixtures, like the numbers. */
const S = {
	live: "Open the live one",
	rows: "List rows keep the tile",
	chips: "Chips: text only",
	menu: "Menu: the three-dot button of one expense, from its registry",
	sheetCap:
		"Dialog on desktop, detent sheet on phone. Esc closes, focus returns, Cmd+Enter saves.",
	openSheet: "Open a sheet",
	sheetTitle: "Add expense",
	save: "Add expense",
	saved: "Expense added",
	empty: "Empty",
	filled: "Foreign: flag chip, rate types, home amount",
	spent: "You spent",
	inBudget: "In budget as",
	rateLabel: "Rate",
	project: "ProjectPicker",
	disabled: "Disabled",
	cellTyped: "Typed",
	cellInvalid: "Invalid: unfinished sum",
	cellForeign: "Foreign: ISO code, home amount under",
	cellReadOnly: "Read-only",
	cellLabel: "Amount for Groceries",
	category: "CategoryPicker",
	person: "PersonPicker",
	date: "DatePicker",
	expense: "Super Norte",
};

/** Fixture rate types for USD in ARS, with what USD 63.40 books at each. */
const RATES = [
	{ type: "official", label: "Official", minor: 141200, home: 8952080 },
	{ type: "blue", label: "Blue", minor: 146800, home: 9307120 },
	{ type: "mep", label: "MEP", minor: 144200, home: 9142280 },
	{ type: "card", label: "Card", minor: 232000, home: 14708800 },
];
const rateHome = (type: string) =>
	RATES.find((r) => r.type === type)?.home ?? 0;

const PROJECTS: PickerProject[] = [
	{
		id: "floripa",
		name: "Viaje a Florianópolis",
		currency: "BRL",
		peopleCount: 7,
	},
	{ id: "depto", name: "Depto Palermo", currency: "ARS", peopleCount: 2 },
	{ id: "obra", name: "Obra del baño", currency: "ARS", peopleCount: 1 },
];

const CATEGORIES: PickerCategory[] = Object.entries(CAT).map(([id, c]) => ({
	id,
	...c,
}));

export function DateRangeSection() {
	const [value, setValue] = useState<DateRangeValue>({
		from: "2026-10-01",
		to: "2026-10-31",
	});
	const shown: DateRangeValue = { from: "2026-10-05", to: "2026-10-18" };
	return (
		<Spec id="daterange">
			<Pair
				desktop={
					<>
						<div className="rounded-panel border-line bg-surface shadow-menu w-fit border">
							<DateRangePanel compare today={TODAY} value={shown} />
						</div>
						<Cap className="mt-3">{S.live}</Cap>
						<DateRange
							onChange={(r) => setValue({ from: r.from, to: r.to })}
							today={TODAY}
							value={value}
						/>
					</>
				}
				phone={
					<DateRangePanel compare={false} phone today={TODAY} value={shown} />
				}
			/>
		</Spec>
	);
}

export function MoneyInputSection() {
	const empty = useMoneyText(null, "ARS");
	const usd = useMoneyText(6340, "USD");
	const [rate, setRate] = useState("blue");
	const brl = useMoneyText(12000, "BRL");
	return (
		<Spec id="moneyinput">
			<States
				items={[
					[
						S.empty,
						<div className="w-85 max-w-full" key="a">
							<MoneyInput
								currency="ARS"
								onChange={empty.onChange}
								value={empty.text}
							/>
						</div>,
					],
					[
						S.filled,
						<div className="w-85 max-w-full" key="b">
							<MoneyInput
								currency="USD"
								home={{
									currency: "ARS",
									label: S.inBudget,
									value: (
										<Money value={{ minor: rateHome(rate), currency: "ARS" }} />
									),
								}}
								label={S.spent}
								onChange={usd.onChange}
								onCurrencyChange={() => {}}
								rates={{
									label: S.rateLabel,
									value: rate,
									onChange: setRate,
									options: RATES.map((r) => ({
										value: r.type,
										label: r.label,
										rate: <Money value={{ minor: r.minor, currency: "ARS" }} />,
									})),
								}}
								value={usd.text}
							/>
						</div>,
					],
					[
						S.disabled,
						<div className="w-85 max-w-full" key="c">
							<MoneyInput
								currency="BRL"
								disabled
								onChange={brl.onChange}
								value={brl.text}
							/>
						</div>,
					],
				]}
			/>
		</Spec>
	);
}

export function MoneyCellSection() {
	const empty = useMoneyText(null, "ARS");
	const typed = useMoneyText(40000, "ARS");
	const bad = useMoneyText(null, "ARS");
	const usd = useMoneyText(6340, "USD");
	return (
		<Spec id="moneycell">
			<States
				items={[
					[
						S.empty,
						<MoneyCell
							currency="ARS"
							key="a"
							label={S.cellLabel}
							onChange={empty.onChange}
							value={empty.text}
						/>,
					],
					[
						S.cellTyped,
						<MoneyCell
							currency="ARS"
							key="b"
							label={S.cellLabel}
							onChange={typed.onChange}
							value={typed.text}
						/>,
					],
					[
						S.cellInvalid,
						<MoneyCell
							currency="ARS"
							key="c"
							label={S.cellLabel}
							onChange={bad.onChange}
							showErrors
							value={bad.text || "1+"}
						/>,
					],
					[
						S.cellForeign,
						<MoneyCell
							currency="USD"
							home={{ minor: rateHome("blue"), currency: "ARS" }}
							key="d"
							label={S.cellLabel}
							onChange={usd.onChange}
							showCurrency
							value={usd.text}
						/>,
					],
					[
						S.cellReadOnly,
						<MoneyCell
							currency="ARS"
							key="e"
							label={S.cellLabel}
							onChange={() => {}}
							readOnly
							value="400"
						/>,
					],
				]}
			/>
		</Spec>
	);
}

export function PickersSection() {
	const [cat, setCat] = useState<string | null>("groceries");
	const [people, setPeople] = useState<string[]>(["lucia"]);
	const [day, setDay] = useState(TODAY);
	const [project, setProject] = useState<string | null>("floripa");
	return (
		<Spec id="catpick">
			<Pair
				desktop={
					<>
						<Cap>{S.category}</Cap>
						<div className="rounded-panel border-line bg-surface shadow-menu w-80 border">
							<CategoryPicker
								categories={CATEGORIES}
								onChange={setCat}
								recentIds={["groceries"]}
								value={cat}
							/>
						</div>
						<Cap className="mt-4">{S.project}</Cap>
						<div className="rounded-panel border-line bg-surface shadow-menu w-80 border">
							<ProjectPicker
								onChange={setProject}
								projects={PROJECTS}
								value={project}
							/>
						</div>
					</>
				}
				phone={
					<>
						<Cap>{S.person}</Cap>
						<div className="rounded-panel border-line bg-surface border">
							<PersonPicker
								onChange={setPeople}
								people={[
									{ id: "lucia", name: "Lucía Fernández", onRetrospend: true },
									{ id: "martin", name: "Martín Acosta", onRetrospend: true },
									{ id: "paz", name: "Paz Ibarra", onRetrospend: false },
								]}
								value={people}
							/>
						</div>
						<Cap className="mt-4">{S.date}</Cap>
						<DatePicker onChange={setDay} today={TODAY} value={day} />
					</>
				}
			/>
		</Spec>
	);
}
