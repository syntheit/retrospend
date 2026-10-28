"use client";

import { draftFromMinor } from "@retrospend/domain/parse";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { MoneyInput } from "~/components/money/money-input";
import { useMoneyLocale } from "~/components/money/use-money-locale";
import { Notice } from "~/components/ui/notice";
import { Sheet } from "~/components/ui/sheet";
import { Skeleton } from "~/components/ui/skeleton";
import { useToast } from "~/components/ui/toast";
import { UnsavedChangesDialog } from "~/components/ui/unsaved-changes-dialog";
import { firstName } from "~/features/people/filter";
import { useSession } from "~/hooks/use-session";
import { useSettings } from "~/hooks/use-settings";
import { generateId } from "~/lib/id";
import { api } from "~/trpc/react";
import { CategoryLine } from "../entry/expense/category-line";
import { validate } from "../entry/expense/draft";
import { SplitSection } from "../entry/expense/split-section";
import { sharesOf } from "../entry/expense/split-view";
import { useExpenseDraft } from "../entry/expense/use-expense-draft";
import {
	type LoadedDraft,
	useExpenseLoad,
} from "../entry/expense/use-expense-load";
import { type EntryCatalog, Field, useEntryCatalog } from "../entry/shared-ui";
import type { EntryPerson } from "../entry/types";
import { CorrectionChanges, personKey } from "./correction-changes";
import { correctionInput } from "./correction-input";
import { usePreview } from "./use-preview";

/**
 * Correct a settled split you added (MONEY-MOVES 1.11). The form is the
 * split as it stands; the server's dry run states each person's difference
 * and what stays, and Record writes only that difference: the original is
 * never rewritten. Undo takes the correction rows back and puts the fix
 * requests it answered back as they were.
 */
export function CorrectSheet({
	id,
	onBack,
	onDone,
}: {
	id: string;
	onBack: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("corrections.correct");
	const catalog = useEntryCatalog();
	const { data: session } = useSession();
	const { data: settings } = useSettings();
	const { data: avatar } = api.profile.getMyAvatar.useQuery();
	const userId = session?.user?.id ?? "";
	const you: EntryPerson = {
		participantType: "user",
		participantId: userId,
		name: session?.user?.name ?? "",
		avatarUrl: avatar?.avatarUrl ?? session?.user?.image ?? null,
	};
	const { loaded, failed } = useExpenseLoad(
		{ kind: "expense", mode: "editShared", id },
		{
			currency: settings?.defaultCurrency ?? catalog.data?.homeCurrency ?? "",
			you: { participantType: "user", participantId: userId },
			ready: !!catalog.data && !!userId && !!settings,
		},
	);
	if (!loaded || !catalog.data) {
		return (
			<Sheet
				detent="large"
				footer={false}
				onOpenChange={(o) => !o && onBack()}
				open
				title={t("loadingTitle")}
			>
				{failed || catalog.isError ? (
					<p className="text-danger text-small" role="alert">
						{t("failed")}
					</p>
				) : (
					<div
						aria-label={t("loading")}
						className="flex flex-col gap-4"
						role="status"
					>
						<Skeleton className="h-money w-full" />
						<Skeleton className="h-ctl w-full" />
						<Skeleton className="h-ctl w-3/4" />
					</div>
				)}
			</Sheet>
		);
	}
	return (
		<CorrectForm
			catalog={catalog.data}
			id={id}
			initial={loaded}
			onBack={onBack}
			onDone={onDone}
			you={you}
		/>
	);
}

function CorrectForm({
	id,
	initial: loaded,
	catalog,
	you,
	onBack,
	onDone,
}: {
	id: string;
	initial: LoadedDraft;
	catalog: EntryCatalog;
	you: EntryPerson;
	onBack: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("corrections.correct");
	const te = useTranslations("entry.expense");
	const locale = useMoneyLocale();
	const toast = useToast();
	const home = catalog.homeCurrency;
	const youRef = {
		participantType: you.participantType,
		participantId: you.participantId,
	};
	// The starting point, kept once: the unsaved check compares to it.
	const [start] = useState(() => ({
		...loaded.draft,
		amountText: loaded.draft.minor
			? draftFromMinor(loaded.draft.minor, locale, loaded.draft.currency)
			: "",
	}));
	const x = useExpenseDraft(start, {
		you: youRef,
		home,
		categories: catalog.categories,
	});
	const { d } = x;
	const errors = validate(d, { home, you: youRef, rateMissing: false });
	const [tried, setTried] = useState(false);
	const [discard, setDiscard] = useState(false);
	const closing = useRef(false);
	// One id per sheet: a retry or a double click writes one correction.
	const [corrId] = useState(generateId);
	const preview = api.corrections.correct.preview.useMutation();
	const save = api.corrections.correct.save.useMutation();
	const undo = api.corrections.undoCorrection.save.useMutation();
	const input = useMemo(
		() =>
			Object.keys(errors).length > 0
				? null
				: correctionInput(d, {
						id: corrId,
						transactionId: id,
						title: t("correctionTitle", { title: start.title }),
						you: youRef,
					}),
		// biome-ignore lint/correctness/useExhaustiveDependencies: errors and youRef follow d
		[d, corrId, id, start.title, t],
	);
	const dry = usePreview((i) => preview.mutateAsync(i), input);
	const names = useMemo(
		() =>
			new Map(
				[you, ...d.others, ...(d.outsidePayer ? [d.outsidePayer] : [])].map(
					(p) => [
						personKey({ type: p.participantType, id: p.participantId }),
						firstName(p.name),
					],
				),
			),
		[you, d.others, d.outsidePayer],
	);
	const nothing = dry.data ? dry.data.value.transactionIds.length === 0 : false;
	const dirty = JSON.stringify(d) !== JSON.stringify(start);
	const shares = sharesOf(d, youRef);

	const close = () => {
		closing.current = true;
		onBack();
	};
	const submit = async () => {
		setTried(true);
		if (!input || !dry.fresh) return false;
		const r = await save.mutateAsync(input);
		toast.saved(t("saved", { title: start.title }), {
			undo: () =>
				undo.mutateAsync({
					transactionIds: r.value.transactionIds,
					resolvedRequests: r.value.resolvedRequests,
				}),
		});
		closing.current = true;
		onDone();
		return false;
	};

	return (
		<>
			<Sheet
				detent="large"
				onOpenChange={(o) =>
					o ? undefined : dirty && !closing.current ? setDiscard(true) : close()
				}
				onSubmit={submit}
				open
				submitDisabled={!input || !dry.fresh || nothing}
				submitLabel={t("record")}
				title={t("sheetTitle", { title: start.title })}
			>
				<div className="flex flex-col gap-4 pb-4">
					<Notice>{t("settled")}</Notice>
					<Field label={te("amount")}>
						<MoneyInput
							currency={d.currency}
							onChange={(text) => x.setAmount(text)}
							operators
							showErrors={tried}
							value={d.amountText}
						/>
					</Field>
					<Field
						error={tried && errors.category ? te("error.category") : null}
						label={te("category")}
					>
						<CategoryLine
							categories={catalog.categories}
							onPick={x.pickCategory}
							recents={catalog.recentCategoryIds}
							value={d.categoryId}
						/>
					</Field>
					<SplitSection
						shares={shares}
						showErrors={tried}
						splitError={!!errors.split}
						x={x}
						you={you}
					/>
					<CorrectionChanges
						diff={dry.data}
						error={dry.error}
						loading={dry.loading}
						me={personKey({ type: "user", id: you.participantId })}
						names={names}
						result={dry.data?.value ?? null}
					/>
				</div>
			</Sheet>
			<UnsavedChangesDialog
				description={te("discard.body")}
				onDiscard={close}
				onOpenChange={(o) => !o && setDiscard(false)}
				onStay={() => setDiscard(false)}
				open={discard}
				title={te("discard.title")}
			/>
		</>
	);
}
