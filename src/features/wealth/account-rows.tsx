"use client";

import type { CSSProperties, ReactNode, Ref } from "react";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import type { AccountTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { AccountRow } from "~/components/rows/account-row";
import { RowList } from "~/components/rows/row";
import { ReorderGroup, SortableItem } from "./reorder";
import { useRateLabel } from "./sheets/rate-type-chips";
import type { WealthAccount } from "./types";

export const targetOf = (a: WealthAccount): AccountTarget => ({
	id: a.id,
	name: a.name,
	closed: a.closedOn != null,
});

/** One group of account rows; with `onMove` they carry a grip and can be dragged. */
export function Rows({
	accounts,
	handlers,
	onOpen,
	label,
	onMove,
}: {
	accounts: WealthAccount[];
	handlers: ActionHandlers<AccountTarget>;
	onOpen?: (a: WealthAccount) => void;
	label: string;
	/** Set in the Custom sort: the rows get a grip and can be dragged. */
	onMove?: (from: number, to: number) => void;
}) {
	const rate = useRateLabel();
	const row = (
		a: WealthAccount,
		extra: {
			ref?: Ref<HTMLLIElement>;
			style?: CSSProperties;
			className?: string;
			handle?: ReactNode;
		} = {},
	) => {
		const target = targetOf(a);
		return (
			<ActionArea
				entity="account"
				handlers={handlers}
				key={a.id}
				target={target}
			>
				<AccountRow
					account={{
						id: a.id,
						name: a.name,
						kind: a.kind,
						icon: a.icon,
						amount: a.amount,
						home: a.home,
						updated: a.updated,
						change: null,
						// The sub line of wealth.html: the code, then how it counts.
						detail: {
							valuedAt: a.rateType ? rate(a.rateType) : null,
							// APR as typed (118 is 118%), in hundredths for the formatter.
							apr: a.apr != null ? Math.round(a.apr * 100) : null,
							noRate: a.home === null,
							closedOn: a.closedOn,
						},
					}}
					actions={
						<ActionMenu entity="account" handlers={handlers} target={target} />
					}
					onOpen={onOpen ? () => onOpen(a) : undefined}
					{...extra}
				/>
			</ActionArea>
		);
	};
	if (!onMove)
		return <RowList label={label}>{accounts.map((a) => row(a))}</RowList>;
	return (
		<ReorderGroup items={accounts} onMove={onMove}>
			<RowList label={label}>
				{accounts.map((a) => (
					<SortableItem id={a.id} key={a.id} name={a.name}>
						{(parts) => row(a, parts)}
					</SortableItem>
				))}
			</RowList>
		</ReorderGroup>
	);
}
