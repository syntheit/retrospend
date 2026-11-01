"use client";

import { dayKey } from "@retrospend/domain/time-zone";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatMoney } from "~/components/money/format";
import { useMoneyLocale } from "~/components/money/use-money-locale";
import { Sheet } from "~/components/ui/sheet";
import { Skeleton } from "~/components/ui/skeleton";
import { useToast } from "~/components/ui/toast";
import { ChangesBlock } from "../changes";
import { ModeSwitch } from "../mode-switch";
import { type EntryCatalog, useEntryCatalog } from "../shared-ui";
import type { EntryCarry, EntryMode } from "../types";
import { IncomeFields } from "./income-fields";
import { useIncome } from "./use-income";

/** Add income: its own sheet (owner N71), Use my plan as the primary path (N72). */
export function IncomeSheet({
	accountId,
	carry,
	onClose,
	onMode,
}: {
	accountId?: string;
	carry?: EntryCarry;
	onClose: () => void;
	onMode: (mode: EntryMode, carry: EntryCarry) => void;
}) {
	const t = useTranslations("entry.income");
	const catalog = useEntryCatalog();
	if (!catalog.data)
		return (
			<Sheet
				detent="large"
				footer={false}
				onOpenChange={(o) => !o && onClose()}
				open
				title={t("title")}
			>
				<Skeleton className="h-40 w-full" />
			</Sheet>
		);
	return (
		<IncomeForm
			accountId={accountId}
			carry={carry}
			catalog={catalog.data}
			onClose={onClose}
			onMode={onMode}
		/>
	);
}

function IncomeForm({
	catalog,
	accountId,
	carry,
	onClose,
	onMode,
}: {
	catalog: EntryCatalog;
	accountId?: string;
	carry?: EntryCarry;
	onClose: () => void;
	onMode: (mode: EntryMode, carry: EntryCarry) => void;
}) {
	const t = useTranslations("entry.income");
	const tc = useTranslations("entry.changes");
	const toast = useToast();
	const locale = useMoneyLocale();
	const x = useIncome(catalog, accountId, carry);
	const { d } = x;
	const [tried, setTried] = useState(false);

	const submit = async () => {
		setTried(true);
		if (!x.valid || !x.input) return false;
		const r = await x.save();
		const v = r.value;
		const amount = v.booked ?? { minor: d.minor ?? 0, currency: d.currency };
		// Toast text is plain text, so the amount goes through the one formatter here.
		const words = {
			amount: formatMoney(amount, { locale }),
			account: x.account?.name ?? "",
		};
		const msg = v.kept
			? t("toast.kept", words)
			: v.plan.applied
				? t("toast.planned", { ...words, count: v.plan.lines.length })
				: x.account
					? t("toast.addedInto", words)
					: t("toast.added", words);
		toast.saved(msg, { undo: () => x.undo(v.expenseId, v.templateId) });
	};

	return (
		<Sheet
			className="md:h-150 md:max-w-4xl"
			detent="large"
			headerSlot={
				<ModeSwitch
					mode="income"
					onMode={(m) =>
						onMode(m, {
							minor: d.minor,
							currency: d.currency,
							date: d.date,
							note: d.note,
						})
					}
				/>
			}
			headerSubmit={t("save")}
			onOpenChange={(o) => !o && onClose()}
			onSubmit={submit}
			open
			submitLabel={t("save")}
			title={t("title")}
			wide
		>
			<IncomeFields
				catalog={catalog}
				changes={
					<ChangesBlock
						byDesign={x.account ? [] : ["accounts"]}
						cannot={x.valid ? x.previewError : null}
						diff={x.preview}
						empty={tc("emptyAmount")}
						loading={x.previewLoading}
					/>
				}
				today={dayKey(new Date())}
				tried={tried}
				x={x}
			/>
		</Sheet>
	);
}
