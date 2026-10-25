"use client";

import { useTranslations } from "next-intl";
import { ActionMenu } from "~/components/actions/action-menu";
import { Row, RowSub } from "~/components/rows/row";
import { PaymentMethodIcon } from "~/components/ui/payment-method-icon";
import type { Method, Visibility } from "./types";

/**
 * One payment method with its one menu (mockup): edit, primary, who sees
 * it, order, remove. The items come from the paymentMethod action registry.
 */
export function MethodRow({
	method: m,
	name,
	first,
	last,
	onEdit,
	onPrimary,
	onVisibility,
	onMove,
	onRemove,
}: {
	method: Method;
	name: string;
	first: boolean;
	last: boolean;
	onEdit: () => void;
	onPrimary: () => void;
	onVisibility: (v: Visibility) => void;
	onMove: (delta: -1 | 1) => void;
	onRemove: () => void;
}) {
	const t = useTranslations("settingsV2.payment");
	const target = {
		id: m.localId,
		name,
		first,
		last,
		visibility: m.visibility,
	};
	const handlers = {
		edit: onEdit,
		makePrimary: onPrimary,
		showPublic: () => onVisibility("PUBLIC"),
		showContacts: () => onVisibility("FRIENDS_ONLY"),
		showSettlement: () => onVisibility("PAYMENT_ONLY"),
		moveUp: () => onMove(-1),
		moveDown: () => onMove(1),
		remove: onRemove,
	};
	return (
		<Row
			actions={
				<ActionMenu
					entity="paymentMethod"
					handlers={handlers}
					target={target}
				/>
			}
			lead={
				<PaymentMethodIcon currency={m.currency} size="md" typeId={m.type} />
			}
			sub={
				<RowSub
					parts={[{ shrink: m.identifier }, t(`visibility.${m.visibility}`)]}
				/>
			}
			title={name}
			titleEnd={
				first ? (
					<span className="text-fg-3 text-meta font-normal">
						{t("primary")}
					</span>
				) : undefined
			}
		/>
	);
}
