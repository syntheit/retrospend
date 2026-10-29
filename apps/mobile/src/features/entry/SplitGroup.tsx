import { View } from "react-native";
import { useTranslations } from "use-intl";

import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import { Avatar, type Face } from "@/ui/Avatar";
import { ListGroup, ListRow, SectionHeader } from "@/ui/List";
import { Text } from "@/ui/Text";
import { type SplitModeName, SplitSummary } from "./ExpenseFields";
import { usePersonFaces } from "./Face";
import type { SavedEntry } from "./hooks";
import { sharesOf } from "./preview";
import { personKey } from "./types";
import type { ComposerPreview } from "./useComposerPreview";
import type { EntryForm } from "./useEntryForm";

type Money = { minor: number; currency: string };

/** What the Split group shows: who paid, how it divides, and each person's part. */
export interface SplitView {
	mode: SplitModeName;
	paidBy: { name: string; face: Face };
	rows: { key: string; name: string; face: Face; share: Money | null }[];
	yourShare: Money | null;
}

/**
 * The split of the open expense, or null for one that is yours alone. A new
 * split is paid by you and divided equally, each share the server's from the
 * dry run. An edit shows the saved split with each share as the dry run of
 * the edit leaves it. Nothing here divides an amount.
 */
export function useSplitView(
	form: EntryForm,
	preview: ComposerPreview,
	edit: SavedEntry | undefined,
): SplitView | null {
	const t = useTranslations("mobile.composer");
	const faces = usePersonFaces();
	const { meId } = form;
	const meFace = (): Face => {
		const [face] = faces([
			{
				key: `user:${meId}`,
				name: form.me?.name ?? t("you"),
				imageUrl: form.me?.avatarUrl ?? null,
			},
		]);
		return face as Face;
	};
	if (edit?.kind === "shared") {
		const moved = new Map(
			(preview.preview.status === "ready"
				? (sharesOf(preview.preview.diff) ?? [])
				: []
			).map((s) => [s.key, s.after]),
		);
		const rows = edit.entry.splits.map((s) => {
			const key = personKey(s);
			const you = s.type === "user" && s.id === meId;
			const [face] = faces([{ key, name: s.name, imageUrl: s.imageUrl }]);
			return {
				key,
				name: you ? t("you") : s.name,
				face: face as Face,
				share: moved.has(key) ? (moved.get(key) ?? null) : s.share,
				you,
			};
		});
		const payer = edit.entry.paidBy;
		const [payerFace] = faces([
			{
				key: personKey(payer),
				name: payer.name,
				imageUrl: payer.imageUrl,
			},
		]);
		return {
			mode: edit.entry.splitMode,
			paidBy: {
				name:
					payer.type === "user" && payer.id === meId ? t("you") : payer.name,
				face: payerFace as Face,
			},
			rows: rows.map(({ you: _you, ...row }) => row),
			yourShare: rows.find((r) => r.you)?.share ?? null,
		};
	}
	if (form.editing || preview.rows.length === 0) return null;
	const rows = preview.rows.map((r) => {
		const [face] = r.person
			? faces([{ key: personKey(r.person), ...r.person }])
			: [meFace()];
		return {
			key: r.key,
			name: r.name,
			face: face as Face,
			share: r.share,
		};
	});
	return {
		mode: "EQUAL",
		paidBy: { name: t("you"), face: meFace() },
		rows,
		yourShare: preview.rows[0]?.share ?? null,
	};
}

/**
 * The Split group of More: Paid by and how it divides, then one row per
 * person with their face and share, and the one-line summary under it. The
 * payer and the mode are facts of the split here; picking another needs the
 * write to carry them.
 */
export function SplitGroup({ split }: { split: SplitView }) {
	const t = useTranslations("mobile.composer.split");
	const { format } = useFormatMoney();
	const { space } = useTheme();
	return (
		<View>
			<SectionHeader title={t("title")} />
			<ListGroup>
				<ListRow
					end={
						<View
							style={{
								flexDirection: "row",
								alignItems: "center",
								gap: space[2],
							}}
						>
							<Avatar face={split.paidBy.face} size="xs" />
							<Text tone="fg2">{split.paidBy.name}</Text>
						</View>
					}
					title={t("paidBy")}
				/>
				<ListRow
					end={<Text tone="fg2">{t(`modes.${split.mode}`)}</Text>}
					title={t("mode")}
				/>
				{split.rows.map((row) => (
					<ListRow
						accessibilityLabel={
							row.share
								? `${row.name}, ${format(row.share, { cents: true }) ?? ""}`
								: row.name
						}
						end={
							row.share ? (
								<Text tabular weight="medium">
									{format(row.share, { cents: true }) ?? ""}
								</Text>
							) : null
						}
						key={row.key}
						lead={<Avatar face={row.face} size="default" />}
						title={row.name}
					/>
				))}
			</ListGroup>
			<View style={{ paddingHorizontal: space[4], paddingTop: space[2] }}>
				<SplitSummary mode={split.mode} yourShare={split.yourShare} />
			</View>
		</View>
	);
}
