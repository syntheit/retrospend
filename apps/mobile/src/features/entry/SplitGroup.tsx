import { View } from "react-native";
import { useTranslations } from "use-intl";

import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import { Avatar, type Face } from "@/ui/Avatar";
import { Chip } from "@/ui/Chip";
import { GroupItem, ListGroup, ListRow, SectionHeader } from "@/ui/List";
import { PickField } from "@/ui/PickField";
import { Skeleton } from "@/ui/Skeleton";
import { StatusText } from "@/ui/StatusText";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { knownPeople } from "./draft";
import { type SplitModeName, SplitSummary } from "./ExpenseFields";
import { usePersonFaces } from "./Face";
import type { SavedEntry } from "./hooks";
import { sharesAfter } from "./preview";
import { CUSTOM_MODES } from "./splitParts";
import { personKey } from "./types";
import type { ComposerPreview } from "./useComposerPreview";
import type { EntryForm } from "./useEntryForm";

type Money = { minor: number; currency: string };

interface SplitPerson {
	key: string;
	name: string;
	face: Face;
}

/** What the Split group shows: who paid, how it divides, and each person's part. */
export interface SplitView {
	mode: SplitModeName;
	/** Who paid. */
	paidBy: SplitPerson;
	/** Who can have paid: you, the others on it, and a saved payer who holds no share. */
	payers: SplitPerson[];
	/** One row per person who shares it. */
	rows: (SplitPerson & { share: Money | null; you: boolean })[];
	yourShare: Money | null;
	/** The dry run of this exact split has not answered: shares shown would be stale. */
	pending: boolean;
}

/**
 * The split of the open expense, or null for one that is yours alone. Who
 * paid and how it divides are the draft's; each share is the server's, from
 * the dry run of this very body (an edit shows the saved share until
 * something changes). Nothing here divides an amount.
 */
export function useSplitView(
	form: EntryForm,
	preview: ComposerPreview,
	edit: SavedEntry | undefined,
): SplitView | null {
	const t = useTranslations("mobile.composer");
	const faces = usePersonFaces();
	const { meId, expense: draft } = form;
	const sharedEdit = edit?.kind === "shared";
	if (form.editing && !sharedEdit) return null;
	if (!form.editing && draft.withKeys.length === 0) return null;

	const youKey = personKey({ type: "user", id: meId });
	const people = knownPeople(draft, form.catalog.people);
	const person = (key: string, name: string, imageUrl: string | null) => {
		const [face] = faces([{ key, name, imageUrl }]);
		return { key, name, face: face as Face };
	};
	const you = person(youKey, t("you"), form.me?.avatarUrl ?? null);
	const others = draft.withKeys.flatMap((key) => {
		const p = people.find((x) => personKey(x) === key);
		return p ? [person(key, p.name, p.imageUrl)] : [];
	});
	const youOn = draft.editing?.split?.youOnSplit ?? true;

	// The server's share after this very body; an edit shows the saved share
	// until something changes, and nothing while its dry run is out.
	const diff = preview.preview.status === "ready" ? preview.preview.diff : null;
	const after = diff ? sharesAfter(diff) : null;
	const saved = new Map(
		(sharedEdit ? edit.entry.splits : []).map((s) => [
			personKey(s),
			s.share as Money,
		]),
	);
	const pending = sharedEdit
		? form.dirty && !after
		: preview.preview.status === "loading";
	const shareOf = (key: string): Money | null => {
		if (pending) return null;
		return (
			after?.get(key) ??
			(sharedEdit && !form.dirty ? saved.get(key) : null) ??
			null
		);
	};

	const members = [...(youOn ? [you] : []), ...others];
	const rows = members.map((m) => ({
		...m,
		share: shareOf(m.key),
		you: m.key === youKey,
	}));
	const outside =
		draft.paidByKey !== null &&
		!draft.withKeys.includes(draft.paidByKey) &&
		draft.editing
			? people.find((x) => personKey(x) === draft.paidByKey)
			: undefined;
	const payers = [
		you,
		...others,
		...(outside
			? [person(personKey(outside), outside.name, outside.imageUrl)]
			: []),
	];
	const paidBy = payers.find((p) => p.key === draft.paidByKey) ?? you;
	return {
		mode: draft.splitMode,
		paidBy,
		payers,
		rows,
		yourShare: rows.find((r) => r.you)?.share ?? null,
		pending,
	};
}

/**
 * The Split group of More: Paid by (a face picker), how it divides, then one
 * row per person with their face and part, and the one-line summary under it.
 * Equally needs no typing. A custom split takes a part for each person (an
 * amount, a percent or shares) and the server says whether they add up: the
 * dry run is refused until they do, and Save waits on it. Percent and shares
 * show each person's share as the server splits it.
 */
export function SplitGroup({
	split,
	form,
	preview,
}: {
	split: SplitView;
	form: EntryForm;
	preview: ComposerPreview;
}) {
	const t = useTranslations("mobile.composer.split");
	const tc = useTranslations("mobile.composer");
	const { format } = useFormatMoney();
	const { space } = useTheme();
	const draft = form.expense;
	const customMode = split.mode === "EQUAL" ? null : split.mode;
	const custom = customMode !== null;
	const youKey = personKey({ type: "user", id: form.meId });
	const money = (value: Money) => format(value, { cents: true }) ?? "";
	const refused =
		preview.preview.status === "refused" && preview.preview.reason === "split";
	const unread = form.tried && form.expenseProblems.split === true;
	return (
		<View>
			<SectionHeader title={t("title")} />
			<ListGroup form>
				<PickField
					empty={tc("faces.empty")}
					find={tc("faces.find")}
					label={t("paidBy")}
					onChange={(id) =>
						form.patchSplit({
							paidByKey: id === null || id === youKey ? null : id,
						})
					}
					rows={split.payers.map((p) => ({
						id: p.key,
						label: p.name,
						lead: <Avatar face={p.face} size="sm" />,
					}))}
					title={t("paidBy")}
					value={split.paidBy.key}
				/>
				<GroupItem>
					<View
						accessibilityLabel={t("mode")}
						accessibilityRole="radiogroup"
						style={{ flexDirection: "row", gap: space[2] }}
					>
						<Chip
							label={t("modes.EQUAL")}
							onPress={() =>
								split.mode === "EQUAL"
									? undefined
									: form.patchSplit({ splitMode: "EQUAL", parts: {} })
							}
							selected={!custom}
						/>
						<Chip
							label={t("custom")}
							onPress={() =>
								custom
									? undefined
									: form.patchSplit({ splitMode: "EXACT", parts: {} })
							}
							selected={custom}
						/>
					</View>
				</GroupItem>
				{custom ? (
					<GroupItem>
						<View
							accessibilityLabel={t("divideBy")}
							accessibilityRole="radiogroup"
							style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}
						>
							{CUSTOM_MODES.map((mode) => (
								<Chip
									key={mode}
									label={t(`modes.${mode}`)}
									onPress={() =>
										split.mode === mode
											? undefined
											: form.patchSplit({ splitMode: mode, parts: {} })
									}
									selected={split.mode === mode}
								/>
							))}
						</View>
					</GroupItem>
				) : null}
				{split.rows.map((row) =>
					custom ? (
						<GroupItem key={row.key}>
							<View
								style={{
									flexDirection: "row",
									alignItems: "flex-end",
									gap: space[3],
									paddingVertical: space[2],
								}}
							>
								<Avatar face={row.face} size="default" />
								<View style={{ flex: 1, gap: space[1] }}>
									<TextField
										invalid={unread && !draft.parts[row.key]?.trim()}
										keyboardType={
											split.mode === "SHARES" ? "number-pad" : "decimal-pad"
										}
										label={row.name}
										onChangeText={(text) =>
											form.patchSplit({
												parts: { ...draft.parts, [row.key]: text },
											})
										}
										onTypingChange={form.setTyping}
										placeholder={t(`part.${customMode}`)}
										prefix={
											split.mode === "EXACT"
												? draft.currency
												: split.mode === "PERCENTAGE"
													? "%"
													: undefined
										}
										value={draft.parts[row.key] ?? ""}
									/>
									{split.mode !== "EXACT" && row.share ? (
										<Text tabular tone="fg2" variant="small">
											{t("theirShare", { amount: money(row.share) })}
										</Text>
									) : null}
								</View>
							</View>
						</GroupItem>
					) : (
						<ListRow
							accessibilityLabel={
								row.share ? `${row.name}, ${money(row.share)}` : row.name
							}
							end={
								split.pending ? (
									<Skeleton shape="money" />
								) : row.share ? (
									<Text tabular weight="medium">
										{money(row.share)}
									</Text>
								) : null
							}
							key={row.key}
							lead={<Avatar face={row.face} size="default" />}
							title={row.name}
						/>
					),
				)}
			</ListGroup>
			<View style={{ paddingHorizontal: space[4], paddingTop: space[2] }}>
				{unread ? (
					<StatusText label={t("partsMissing")} tone="attention" />
				) : refused ? (
					<StatusText label={t("partsOff")} tone="attention" />
				) : (
					<SplitSummary mode={split.mode} yourShare={split.yourShare} />
				)}
			</View>
		</View>
	);
}
