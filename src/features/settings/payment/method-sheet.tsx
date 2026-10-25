"use client";

import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Sheet } from "~/components/ui/sheet";
import {
	getCurrencyForType,
	getMethodType,
	type PaymentMethodTypeDef,
} from "~/lib/payment-method-registry";
import { type MethodDraft, MethodFields } from "./method-fields";
import { TypePicker } from "./type-picker";
import { type Method, newLocalId } from "./types";

const EMPTY: MethodDraft = {
	type: "",
	identifier: "",
	label: "",
	showLabel: false,
	currency: "",
	network: "",
	minAmount: "",
	visibility: "PAYMENT_ONLY",
};

const draftOf = (m: Method): MethodDraft => ({
	type: m.type,
	identifier: m.identifier,
	label: m.label,
	showLabel: !!m.label,
	currency: m.currency,
	network: m.network,
	minAmount: m.minAmount,
	visibility: m.visibility,
});

/**
 * Add or edit one payment method: pick a platform, then fill its fields.
 * Editing starts on the fields. Save hands the method to the list, which
 * writes the whole list with Undo.
 */
export function MethodSheet({
	open,
	onClose,
	onSave,
	editing,
	userCurrency,
}: {
	open: boolean;
	onClose: () => void;
	onSave: (m: Method) => void;
	/** null adds a new method. */
	editing: Method | null;
	userCurrency: string;
}) {
	const t = useTranslations("settingsPage");
	const [step, setStep] = useState<"pick" | "form">("pick");
	const [draft, setDraft] = useState<MethodDraft>(EMPTY);

	useEffect(() => {
		if (!open) return;
		setStep(editing ? "form" : "pick");
		setDraft(editing ? draftOf(editing) : EMPTY);
	}, [open, editing]);

	const select = (def: PaymentMethodTypeDef) => {
		setDraft({
			...EMPTY,
			type: def.id,
			network: def.defaultNetwork ?? "",
			currency: getCurrencyForType(def.id) ?? "",
		});
		setStep("form");
	};

	const save = () => {
		const def = getMethodType(draft.type);
		if (!def) return false;
		if (def.identifierType !== "none" && !draft.identifier.trim())
			throw new Error(t("identifierRequired", { label: def.identifierLabel }));
		onSave({
			id: editing?.id,
			localId: editing?.localId ?? newLocalId(),
			type: draft.type,
			label: draft.showLabel ? draft.label : "",
			identifier: draft.identifier.trim(),
			visibility: draft.visibility,
			minAmount: draft.minAmount,
			currency: draft.currency,
			network: draft.network,
		});
	};

	const picking = step === "pick";
	return (
		<Sheet
			description={picking ? t("choosePlatform") : undefined}
			footer={picking ? false : undefined}
			onOpenChange={(o) => !o && onClose()}
			onSubmit={picking ? undefined : save}
			open={open}
			submitLabel={
				picking
					? undefined
					: editing
						? t("savePaymentMethod")
						: t("addPaymentMethod")
			}
			title={editing ? t("editPaymentMethod") : t("addPaymentMethod")}
		>
			{picking ? (
				<TypePicker onSelect={select} userCurrency={userCurrency} />
			) : (
				<div className="flex flex-col gap-4">
					{!editing && (
						<div>
							<Button
								kind="ghost"
								onClick={() => setStep("pick")}
								size="sm"
								type="button"
							>
								<ChevronLeft aria-hidden="true" />
								{t("backToPlatforms")}
							</Button>
						</div>
					)}
					<MethodFields
						draft={draft}
						onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
					/>
				</div>
			)}
		</Sheet>
	);
}
