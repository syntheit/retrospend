"use client";

import type { ReactNode } from "react";
import { Balance } from "~/components/money/balance";
import { Face } from "~/components/ui/avatar-face";
import { StatusDot } from "~/components/ui/status-dot";
import { Row, type RowPassThrough, RowSub, useRowVariant } from "./row";
import type { PersonVM } from "./types";

/**
 * PersonRow: a person with one balance. "Not on Retrospend" is a status
 * under the name, never a dashed ring. The balance words carry the sign
 * (R5), and phone stacks the words over the amount to keep the name wide.
 */
export function PersonRow({
	person,
	actions,
	...rest
}: {
	person: PersonVM;
	actions?: ReactNode;
} & RowPassThrough) {
	const variant = useRowVariant();
	return (
		<Row
			{...rest}
			actions={actions}
			end={
				<Balance
					amount={person.balance}
					figure={person.figure}
					className={
						variant === "group"
							? "flex flex-col items-end"
							: variant === "auto"
								? "max-md:flex max-md:flex-col max-md:items-end"
								: undefined
					}
				/>
			}
			lead={<Face imageUrl={person.imageUrl} name={person.name} size="md" />}
			open={{ href: person.href }}
			sub={
				<RowSub
					parts={[
						{ shrink: person.lastShared },
						!person.onRetrospend && (
							<StatusDot kind="notOnRetrospend" size="sm" />
						),
					]}
				/>
			}
			title={person.name}
		/>
	);
}
