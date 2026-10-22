"use client";

import { useState } from "react";
import { ActionMenu } from "~/components/actions/action-menu";
import type { ExpenseTarget } from "~/components/actions/registry";
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
import { CategoryTile, Row, RowList } from "~/components/rows/row";
import { Button } from "~/components/ui/button";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import { Sheet } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { CAT, TODAY } from "../fixtures/rows";
import { Cap, Pair, Spec, States } from "../spec";
import { ACTION_IDS, useDemoHandlers } from "./demo";

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
	filled: "Filled, foreign (rate chip)",
	disabled: "Disabled",
	rate: "USD 1 = ARS 1,412 · Official · Oct 21",
	category: "CategoryPicker",
	person: "PersonPicker",
	date: "DatePicker",
	expense: "Super Norte",
};

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

export function IdentitySection() {
	const [cat, setCat] = useState<string | null>("groceries");
	return (
		<Spec id="identity">
			<Pair
				desktop={
					<div className="rounded-panel border-line bg-surface shadow-menu w-80 border">
						<CategoryPicker
							categories={CATEGORIES}
							onChange={setCat}
							recentIds={["groceries", "restaurants"]}
							value={cat}
						/>
					</div>
				}
				phone={
					<>
						<Cap>{S.rows}</Cap>
						<RowList variant="group">
							{[CAT.groceries, CAT.restaurants, CAT.transport].map((c) => (
								<Row
									key={c.name}
									lead={<CategoryTile category={c} />}
									title={c.name}
								/>
							))}
						</RowList>
						<Cap className="mt-4">{S.chips}</Cap>
						<FilterChips>
							<FilterChip selected>{CAT.groceries.name}</FilterChip>
							<FilterChip>{CAT.restaurants.name}</FilterChip>
							<FilterChip>{CAT.transport.name}</FilterChip>
						</FilterChips>
					</>
				}
			/>
		</Spec>
	);
}

export function MenuSection() {
	const handlers = useDemoHandlers<ExpenseTarget>(ACTION_IDS.expense);
	const target: ExpenseTarget = {
		id: "t6",
		name: S.expense,
		mine: true,
		locked: false,
		reviewed: false,
		shared: false,
	};
	return (
		<Spec id="menu">
			<Cap>{S.menu}</Cap>
			<ActionMenu
				align="start"
				entity="expense"
				handlers={handlers}
				target={target}
			/>
		</Spec>
	);
}

export function SheetSection() {
	const [open, setOpen] = useState(false);
	const toast = useToast();
	const amount = useMoneyText(2500000, "ARS");
	return (
		<Spec id="sheet">
			<Cap>{S.sheetCap}</Cap>
			<Button kind="primary" onClick={() => setOpen(true)}>
				{S.openSheet}
			</Button>
			<Sheet
				onOpenChange={setOpen}
				onSubmit={() => {
					toast.saved(S.saved, { undo: () => undefined });
					return true;
				}}
				open={open}
				submitLabel={S.save}
				title={S.sheetTitle}
			>
				<MoneyInput
					currency="ARS"
					onChange={amount.onChange}
					value={amount.text}
				/>
			</Sheet>
		</Spec>
	);
}

export function MoneyInputSection() {
	const empty = useMoneyText(null, "ARS");
	const usd = useMoneyText(6340, "USD");
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
								onChange={usd.onChange}
								rate={{ label: S.rate }}
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

export function PickersSection() {
	const [cat, setCat] = useState<string | null>("groceries");
	const [people, setPeople] = useState<string[]>(["lucia"]);
	const [day, setDay] = useState(TODAY);
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
