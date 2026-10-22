"use client";

import { type ReactNode, useState } from "react";
import { MoneyInput, useMoneyText } from "~/components/money/money-input";
import { Button } from "~/components/ui/button";
import { Sheet, type SheetDetent } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
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
	large: "Large detent (phone)",
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
	children,
}: {
	title: string;
	verb: string;
	done: string;
	detent?: SheetDetent;
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
							key="l"
							title={S.add}
							verb={S.add}
						/>,
					],
					[S.nested, <NestedDemo key="n" />],
				]}
			/>
		</Spec>
	);
}
