"use client";

import { type ReactNode, useState } from "react";
import { Money } from "~/components/money/money";
import { MoneyInput, useMoneyText } from "~/components/money/money-input";
import { Button } from "~/components/ui/button";
import { Sheet, type SheetDetent } from "~/components/ui/sheet";
import { ChangeValue, SheetChanges } from "~/components/ui/sheet-changes";
import { useToast } from "~/components/ui/toast";
import { m } from "../fixtures/rows";
import { Cap, Spec, States } from "../spec";

/** Sample copy inside the samples: fixtures, like the numbers. */
const S = {
	add: "Add expense",
	settle: "Settle up",
	record: "Record",
	saved: "Expense added",
	recorded: "Payment recorded",
	dialog: "Dialog (desktop): Esc closes, focus returns, Cmd+Enter saves",
	medium: "Medium detent (phone): drag the grabber",
	large:
		"Large detent (phone): the verb in the header, math keys under the amount",
	addShort: "Add",
	changes:
		"What this changes (R30): what moves, then one sentence for what stays",
	spent: "Spent this month",
	envelope: "Groceries envelope",
	stays: "your accounts",
	stays2: "net worth",
	nested: "Nested: Cancel returns to the parent",
	open: "Open",
	inner: "Pick a category",
	choose: "Choose",
	static:
		"A sheet only renders as an overlay; open each one to see it. Phone widths draw the detent sheet, wider ones the dialog.",
};

/** One live sheet with an amount, opened by its button. */
export function SheetDemo({
	title,
	verb,
	done,
	detent,
	headerVerb,
	children,
}: {
	title: string;
	verb: string;
	done: string;
	detent?: SheetDetent;
	/** Phone web: the short verb in the header (the Add sheet). */
	headerVerb?: string;
	children?: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const toast = useToast();
	const amount = useMoneyText(2500000, "ARS");
	return (
		<>
			<Button kind="secondary" onClick={() => setOpen(true)} size="sm">
				{S.open}
			</Button>
			<Sheet
				detent={detent}
				headerSubmit={headerVerb}
				onOpenChange={setOpen}
				onSubmit={() => {
					toast.saved(done, { undo: () => undefined });
					return true;
				}}
				open={open}
				submitLabel={verb}
				title={title}
			>
				<MoneyInput
					currency="ARS"
					onChange={amount.onChange}
					operators={!!headerVerb}
					value={amount.text}
				/>
				{children}
			</Sheet>
		</>
	);
}

/** A sheet that opens a second one; its Cancel goes back to the first. */
function NestedDemo() {
	const [inner, setInner] = useState(false);
	return (
		<SheetDemo done={S.saved} title={S.add} verb={S.add}>
			<div className="mt-4">
				<Button kind="ghost" onClick={() => setInner(true)} size="sm">
					{S.inner}
				</Button>
			</div>
			<Sheet
				onOpenChange={setInner}
				onSubmit={() => true}
				open={inner}
				submitLabel={S.choose}
				title={S.inner}
			/>
		</SheetDemo>
	);
}

export function SheetSection() {
	return (
		<Spec id="sheet">
			<Cap>{S.static}</Cap>
			<States
				items={[
					[
						S.dialog,
						<SheetDemo done={S.saved} key="d" title={S.add} verb={S.add} />,
					],
					[
						S.medium,
						<SheetDemo
							detent="medium"
							done={S.recorded}
							key="m"
							title={S.settle}
							verb={S.record}
						/>,
					],
					[
						S.large,
						<SheetDemo
							detent="large"
							done={S.saved}
							headerVerb={S.addShort}
							key="l"
							title={S.add}
							verb={S.add}
						/>,
					],
					[S.nested, <NestedDemo key="n" />],
					[
						S.changes,
						<div className="w-105 max-w-full" key="c">
							<SheetChanges
								lines={[
									{
										key: "spent",
										label: S.spent,
										value: (
											<ChangeValue
												delta={<Money sign="exceptZero" value={m("25000")} />}
												to={<Money value={m("2731602")} />}
											/>
										),
									},
									{
										key: "envelope",
										label: S.envelope,
										value: (
											<ChangeValue
												delta={<Money sign="exceptZero" value={m("-25000")} />}
												to={<Money value={m("118400")} />}
											/>
										),
									},
								]}
								stays={[S.stays, S.stays2]}
							/>
						</div>,
					],
				]}
			/>
		</Spec>
	);
}
