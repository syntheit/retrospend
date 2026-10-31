import { Pressable, View } from "react-native";
import { useTranslations } from "use-intl";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { GlyphPill } from "@/ui/GlyphPill";
import { StatusText } from "@/ui/StatusText";
import { Text } from "@/ui/Text";
import { FaceRow } from "./FaceRow";
import { CUSTOM_MODES, type SplitMode } from "./splitParts";
import { personKey } from "./types";
import type { ComposerPreview } from "./useComposerPreview";
import type { EntryForm } from "./useEntryForm";
import type { SplitView } from "./useSplitView";

type Money = { minor: number; currency: string };

/** The split choices in the order they are offered. */
const MODES: SplitMode[] = ["EQUAL", ...CUSTOM_MODES];

/**
 * The one line under the split: what each person pays and, when someone else
 * paid, what you owe them. Every figure is the server's share from the dry
 * run of this very split; until it answers, the line says only how it divides.
 */
export function useSplitLine(split: SplitView | null): string | null {
	const t = useTranslations("mobile.composer.who");
	const ts = useTranslations("mobile.composer.split");
	const { format } = useFormatMoney();
	if (!split) return null;
	const money = (m: Money) => format(m, { cents: true }) ?? "";
	if (!split.yourShare) return ts(`summary.${split.mode}`);
	const share = money(split.yourShare);
	const first =
		split.mode === "EQUAL"
			? t("eachPays", { amount: share })
			: t("yourShare", { amount: share });
	const owes =
		split.paidBy.key !== split.rows.find((r) => r.you)?.key
			? t("youOwe", { name: split.paidBy.name, amount: share })
			: null;
	return owes ? `${first} · ${owes}` : first;
}

/**
 * Who it is split with, in place. The face row picks the people (you are
 * always on it). Once it is shared, Paid by is a row of the people on the
 * split and Split is a row of how it divides: Equally needs nothing typed;
 * Amounts, Percent and Shares show each person's part, and a tap on a part
 * puts the keypad on it. The server says whether the parts add up; Save
 * waits on it.
 */
export function WhoPanel({
	form,
	preview,
	split,
	people,
	part,
	onPart,
	onPicked,
}: {
	form: EntryForm;
	preview: ComposerPreview;
	split: SplitView | null;
	/** Everyone the split can name: the catalog's, or the project's. */
	people: Parameters<typeof FaceRow>[0]["people"];
	/** The person key whose part the keypad types, or null for the amount. */
	part: string | null;
	/** Puts the keypad on a person's part. */
	onPart: (key: string | null) => void;
	/** The person picked someone or a way to split: the keys may fold. */
	onPicked: () => void;
}) {
	const tw = useTranslations("mobile.composer.who");
	const ts = useTranslations("mobile.composer.split");
	const { format } = useFormatMoney();
	const { color, radius, size, space } = useTheme();
	const draft = form.expense;
	const editing = draft.editing !== null;
	const youKey = personKey({ type: "user", id: form.meId });
	const line = useSplitLine(split);
	const money = (m: Money) => format(m, { cents: true }) ?? "";
	const customMode = split && split.mode !== "EQUAL" ? split.mode : null;
	const refused =
		preview.preview.status === "refused" && preview.preview.reason === "split";
	const unread = form.tried && form.expenseProblems.split === true;

	function togglePerson(key: string) {
		form.patchExpense({
			withKeys: draft.withKeys.includes(key)
				? draft.withKeys.filter((k) => k !== key)
				: [...draft.withKeys, key],
		});
		onPicked();
	}

	return (
		<View style={{ gap: space[3] }}>
			{!editing && people.length > 0 ? (
				<FaceRow
					onToggle={togglePerson}
					people={people}
					selected={draft.withKeys}
				/>
			) : null}
			{split ? (
				<View style={{ gap: space[2] }}>
					<Text tone="fg3" variant="meta">
						{ts("paidBy")}
					</Text>
					<View
						accessibilityLabel={ts("paidBy")}
						accessibilityRole="radiogroup"
						style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}
					>
						{split.payers.map((p) => (
							<GlyphPill
								accessibilityLabel={tw("paidByPerson", { name: p.name })}
								face={p.face}
								key={p.key}
								label={p.name.split(/\s+/)[0] ?? p.name}
								onPress={() => {
									form.patchSplit({
										paidByKey: p.key === youKey ? null : p.key,
									});
									onPicked();
								}}
								selected={split.paidBy.key === p.key}
							/>
						))}
					</View>
					<Text tone="fg3" variant="meta">
						{ts("title")}
					</Text>
					<View
						accessibilityLabel={ts("mode")}
						accessibilityRole="radiogroup"
						style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}
					>
						{MODES.map((mode) => (
							<GlyphPill
								key={mode}
								label={ts(`short.${mode}`)}
								onPress={() => {
									if (split.mode === mode) return;
									form.patchSplit({ splitMode: mode, parts: {} });
									onPart(null);
									// Equally needs no typing, so the keys may fold; the others wait for parts.
									if (mode === "EQUAL") onPicked();
								}}
								selected={split.mode === mode}
							/>
						))}
					</View>
					{customMode
						? split.rows.map((row) => {
								const text = draft.parts[row.key] ?? "";
								const active = part === row.key;
								const invalid = unread && !text.trim();
								const shown =
									customMode === "EXACT"
										? `${draft.currency} ${text}`.trim()
										: customMode === "PERCENTAGE"
											? `${text}%`
											: text;
								return (
									<View key={row.key} style={{ gap: space[1] }}>
										<Pressable
											accessibilityLabel={`${row.name}, ${text || ts(`part.${customMode}`)}`}
											accessibilityRole="button"
											accessibilityState={{ selected: active }}
											onPress={() => onPart(row.key)}
											style={{
												minHeight: size.touchMin.phone + space[1],
												flexDirection: "row",
												alignItems: "center",
												gap: space[3],
												paddingHorizontal: space[3],
												borderRadius: radius.panel,
												borderWidth: 1,
												borderColor: invalid
													? color.danger
													: active
														? color.brand
														: "transparent",
												backgroundColor: active
													? color.brandSoft
													: color.surface,
											}}
										>
											<Avatar face={row.face} size="sm" />
											<Text numberOfLines={1} style={{ flex: 1 }}>
												{row.name}
											</Text>
											<Text tabular tone={text ? "fg" : "fg3"} weight="medium">
												{text ? shown : ts(`part.${customMode}`)}
											</Text>
										</Pressable>
										{customMode !== "EXACT" && row.share ? (
											<View style={{ alignItems: "flex-end" }}>
												<Text tabular tone="fg3" variant="meta">
													{ts("theirShare", { amount: money(row.share) })}
												</Text>
											</View>
										) : null}
									</View>
								);
							})
						: null}
					{unread ? (
						<StatusText label={ts("partsMissing")} tone="attention" />
					) : refused ? (
						<StatusText label={ts("partsOff")} tone="attention" />
					) : (
						<Text accessibilityLiveRegion="polite" tone="fg2" variant="small">
							{line}
						</Text>
					)}
				</View>
			) : editing ? null : (
				<Text style={{ textAlign: "center" }} tone="fg2" variant="small">
					{tw("tapFaces")}
				</Text>
			)}
		</View>
	);
}
