"use client";

import { useTranslations } from "next-intl";
import { Skeleton } from "~/components/ui/skeleton";
import { Sheet } from "~/components/ui/sheet";
import { useSession } from "~/hooks/use-session";
import { useSettings } from "~/hooks/use-settings";
import { api } from "~/trpc/react";
import { useEntryCatalog } from "../shared-ui";
import type { EntryPerson, EntryRequest } from "../types";
import { ExpenseForm } from "./expense-form";
import { type ExpenseRequest, useExpenseLoad } from "./use-expense-load";

/**
 * Add or edit an expense (kit expense-sheet.js, ADD-EXPENSE-R2): loads what
 * the form needs (the catalog, who you are, the saved expense on edit),
 * then mounts the form once with that as its starting state.
 */
export function ExpenseSheet({
	request,
	onClose,
	onOpen,
}: {
	request: ExpenseRequest | Extract<EntryRequest, { kind: "expense" }>;
	onClose: () => void;
	onOpen: (r: EntryRequest) => void;
}) {
	const t = useTranslations("entry");
	const catalog = useEntryCatalog();
	const { data: session } = useSession();
	const { data: settings } = useSettings();
	const { data: avatar } = api.profile.getMyAvatar.useQuery();
	const { data: favorites } = api.preferences.getFavoriteCurrencies.useQuery();
	const userId = session?.user?.id ?? "";
	const you: EntryPerson = {
		participantType: "user",
		participantId: userId,
		name: session?.user?.name ?? t("expense.you"),
		avatarUrl: avatar?.avatarUrl ?? session?.user?.image ?? null,
	};
	const home = catalog.data?.homeCurrency ?? "";
	const { loaded, failed } = useExpenseLoad(request as ExpenseRequest, {
		currency: settings?.defaultCurrency ?? home,
		you: { participantType: "user", participantId: userId },
		ready: !!catalog.data && !!userId && !!settings,
	});

	if (!loaded || !catalog.data) {
		return (
			<Sheet
				detent="large"
				footer={false}
				onOpenChange={(o) => !o && onClose()}
				open
				title={
					request.mode === "create"
						? t("expense.title.new")
						: t("expense.title.edit")
				}
			>
				{failed || catalog.isError ? (
					<p className="text-danger text-small" role="alert">
						{t("common.failed")}
					</p>
				) : (
					<div aria-label={t("common.loading")} className="flex flex-col gap-4">
						<Skeleton className="h-money w-full" />
						<Skeleton className="h-ctl w-full" />
						<Skeleton className="h-ctl w-3/4" />
						<Skeleton className="h-ctl w-1/2" />
					</div>
				)}
			</Sheet>
		);
	}
	return (
		<ExpenseForm
			catalog={catalog.data}
			favorites={favorites}
			initial={loaded}
			onClose={onClose}
			onOpen={onOpen}
			request={request as ExpenseRequest}
			you={you}
		/>
	);
}
