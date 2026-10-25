"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { AvailablePill } from "~/components/money/available-pill";
import { Money } from "~/components/money/money";
import { CategoryTile } from "~/components/ui/category-badge";
import { Row, RowBar, type RowPassThrough, RowSub } from "./row";
import type { EnvelopeVM } from "./types";

/**
 * EnvelopeRow: a budget envelope as icon, name, its target line, a thin bar
 * of what it spent, and one Available pill with its word. Assigned and
 * Activity live in the envelope's detail, not on the row.
 *
 * The Budget page (budget.html) adds the target sentence under the name and
 * shows a plain amount while the envelope is fine, so the pill only appears
 * when it needs you (`plain`). Without a share from the server there is no
 * bar (`spent` left out).
 */
export function EnvelopeRow({
	envelope,
	onOpen,
	target,
	plain = false,
	noAmount = false,
	actions,
	...rest
}: {
	envelope: EnvelopeVM;
	onOpen?: () => void;
	/** The target sentence (RowSub parts), above the bar. */
	target?: ReactNode[];
	/** Show a plain amount, not a pill, unless the envelope is over or short. */
	plain?: boolean;
	/** Nothing to hold or to owe (a Limits envelope with no limit): no amount at the end. */
	noAmount?: boolean;
	actions?: ReactNode;
} & RowPassThrough) {
	const t = useTranslations("rows.envelope");
	const needsYou = envelope.status !== "funded";
	return (
		<Row
			{...rest}
			actions={actions}
			end={
				noAmount ? undefined : plain && !needsYou ? (
					<Money
						className="font-semibold"
						figure={envelope.figure}
						value={envelope.available}
					/>
				) : (
					<AvailablePill
						amount={envelope.available}
						figure={envelope.figure}
						status={envelope.status}
					/>
				)
			}
			lead={<CategoryTile category={envelope.category} />}
			open={onOpen ? { onOpen, label: envelope.name } : undefined}
			sub={
				<>
					{target && target.length > 0 && <RowSub parts={target} />}
					{envelope.spent != null && (
						<RowBar
							basis={envelope.spent}
							label={t("spent")}
							over={envelope.status === "overspent"}
						/>
					)}
				</>
			}
			title={envelope.name}
		/>
	);
}
