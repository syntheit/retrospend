"use client";

import { fromMinorUnits } from "@retrospend/domain/money";
import { parseMoneyInput } from "@retrospend/domain/parse";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Money } from "~/components/money/money";
import { MoneyInput } from "~/components/money/money-input";
import { useMoneyLocale } from "~/components/money/use-money-locale";
import { DatePicker } from "~/components/pickers/date-picker";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Sheet } from "~/components/ui/sheet";
import { ChangeValue, SheetChanges } from "~/components/ui/sheet-changes";
import { useToast } from "~/components/ui/toast";
import { api } from "~/trpc/react";
import { inOurWords } from "../errors";
import type { PageView } from "../types";

/**
 * Add expense for a guest who may contribute: what it was, how much and
 * when, paid by you and split equally between everyone in the project. A
 * guest has no categories or other currencies; those need an account. The
 * sheet says what it adds and what stays, and the toast offers Undo.
 */
export function GuestAddSheet({
	view,
	onOpenChange,
	onChanged,
}: {
	view: PageView;
	onOpenChange: (open: boolean) => void;
	/** Reads the page again after a save or an undo. */
	onChanged: () => void;
}) {
	const t = useTranslations("projectShared.add");
	const te = useTranslations("projectShared.errors");
	const locale = useMoneyLocale();
	const toast = useToast();
	const create = api.sharedTransaction.create.useMutation();
	const remove = api.sharedTransaction.delete.useMutation();
	const cur = view.primaryCurrency;
	const [title, setTitle] = useState("");
	const [amountText, setAmountText] = useState("");
	const [minor, setMinor] = useState<number | null>(null);
	const [date, setDate] = useState(view.today);
	const [tried, setTried] = useState(false);
	const me = view.members.find((m) => m.isMe);
	const people = view.members.filter((m) => !m.leftOn);
	const valid = title.trim() !== "" && minor !== null && minor > 0 && !!me;

	const submit = async () => {
		setTried(true);
		if (!valid || !me || minor === null) return false;
		const created = await inOurWords(
			() =>
				create.mutateAsync({
					amount: fromMinorUnits(minor, cur),
					currency: cur,
					description: title.trim(),
					date: new Date(`${date}T12:00:00`),
					paidBy: {
						participantType: me.participantType,
						participantId: me.participantId,
					},
					splitWith: people.map((p) => ({
						participantType: p.participantType,
						participantId: p.participantId,
					})),
					splitMode: "EQUAL",
					projectId: view.id,
				}),
			te("failed"),
		);
		onChanged();
		toast.saved(t("added", { title: title.trim() }), {
			undo: async () => {
				// The sheet showed what it adds, so taking it back needs no second question.
				await remove.mutateAsync({
					id: created.transaction.id,
					confirmUnsettled: true,
				});
				onChanged();
			},
		});
	};

	return (
		<Sheet
			detent="large"
			onOpenChange={onOpenChange}
			onSubmit={submit}
			open
			submitLabel={t("submit")}
			title={t("title", { project: view.name })}
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-1">
					<Label htmlFor="ga-title">{t("what")}</Label>
					<Input
						aria-invalid={tried && title.trim() === "" ? true : undefined}
						autoComplete="off"
						autoFocus
						id="ga-title"
						maxLength={500}
						onChange={(e) => setTitle(e.target.value)}
						value={title}
					/>
				</div>
				<MoneyInput
					currency={cur}
					onChange={(text) => {
						const r = parseMoneyInput(text, locale, cur);
						setAmountText(text);
						setMinor(r.ok ? r.minor : null);
					}}
					showErrors={tried}
					value={amountText}
				/>
				<div className="flex flex-col gap-1">
					<Label>{t("date")}</Label>
					<DatePicker onChange={setDate} today={view.today} value={date} />
				</div>
				<SheetChanges
					lines={
						minor && minor > 0
							? [
									{
										key: "project",
										label: view.name,
										value: (
											<ChangeValue
												delta={
													<Money
														sign="exceptZero"
														value={{ minor, currency: cur }}
													/>
												}
											/>
										),
									},
								]
							: []
					}
					stays={[t("staysExpenses"), t("staysPayments")]}
					status={minor && minor > 0 ? undefined : t("fillIn")}
				>
					{minor && minor > 0 ? (
						<p className="text-fg-2 text-small">
							{t("split", { count: people.length })}
						</p>
					) : null}
				</SheetChanges>
			</div>
		</Sheet>
	);
}
