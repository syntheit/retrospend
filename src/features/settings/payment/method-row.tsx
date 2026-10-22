"use client";

import { ArrowDown, ArrowUp, Check, Pencil, Star, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Row, RowSub } from "~/components/rows/row";
import type {
	Method,
	Visibility,
} from "~/components/settings/payment-methods-card";
import {
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { PaymentMethodIcon } from "~/components/ui/payment-method-icon";
import { MoreMenu } from "../more-menu";

const VISIBILITIES: Visibility[] = ["PUBLIC", "FRIENDS_ONLY", "PAYMENT_ONLY"];

/** One payment method with its one menu (mockup): edit, primary, who sees it, order, remove. */
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
	return (
		<Row
			actions={
				<MoreMenu label={t("actions", { name })}>
					<DropdownMenuItem onSelect={onEdit}>
						<Pencil aria-hidden="true" />
						{t("edit")}
					</DropdownMenuItem>
					{!first && (
						<DropdownMenuItem onSelect={onPrimary}>
							<Star aria-hidden="true" />
							{t("makePrimary")}
						</DropdownMenuItem>
					)}
					<DropdownMenuSeparator />
					<DropdownMenuLabel>{t("visibleTo")}</DropdownMenuLabel>
					{VISIBILITIES.map((v) => (
						<DropdownMenuItem key={v} onSelect={() => onVisibility(v)}>
							{m.visibility === v ? (
								<Check aria-hidden="true" />
							) : (
								<span className="size-4" />
							)}
							{t(`visibility.${v}`)}
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuItem disabled={first} onSelect={() => onMove(-1)}>
						<ArrowUp aria-hidden="true" />
						{t("moveUp")}
					</DropdownMenuItem>
					<DropdownMenuItem disabled={last} onSelect={() => onMove(1)}>
						<ArrowDown aria-hidden="true" />
						{t("moveDown")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem onSelect={onRemove} variant="destructive">
						<Trash2 aria-hidden="true" />
						{t("remove")}
					</DropdownMenuItem>
				</MoreMenu>
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
					<span className="font-normal text-fg-3 text-meta">
						{t("primary")}
					</span>
				) : undefined
			}
		/>
	);
}
