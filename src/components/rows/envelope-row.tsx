"use client";

import { useTranslations } from "next-intl";
import { AvailablePill } from "~/components/money/available-pill";
import { CategoryTile } from "~/components/ui/category-badge";
import { Row, RowBar, type RowPassThrough } from "./row";
import type { EnvelopeVM } from "./types";

/**
 * EnvelopeRow: a budget envelope as icon, name, a thin bar of what it spent,
 * and one Available pill with its word. Assigned and Activity live in the
 * envelope's detail, not on the row.
 */
export function EnvelopeRow({
	envelope,
	onOpen,
	...rest
}: {
	envelope: EnvelopeVM;
	onOpen?: () => void;
} & RowPassThrough) {
	const t = useTranslations("rows.envelope");
	return (
		<Row
			{...rest}
			end={
				<AvailablePill
					amount={envelope.available}
					figure={envelope.figure}
					status={envelope.status}
				/>
			}
			lead={<CategoryTile category={envelope.category} />}
			open={onOpen ? { onOpen, label: envelope.name } : undefined}
			sub={
				<RowBar
					basis={envelope.spent}
					label={t("spent")}
					over={envelope.status === "overspent"}
				/>
			}
			title={envelope.name}
		/>
	);
}
