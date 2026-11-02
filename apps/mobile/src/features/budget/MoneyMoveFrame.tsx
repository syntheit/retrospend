import { categoryTone } from "@retrospend/domain/category-tone";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { AmountEntry } from "@/features/entry/AmountEntry";
import { ComposerFrame } from "@/features/entry/ComposerFrame";
import { useMoneyText } from "@/features/read/useMoneyText";
import { minorOf, readAmount } from "@/features/write/amount";
import { Note, useAmountLocale } from "@/features/write/parts";
import { useAmountLine } from "@/features/write/useAmountLine";
import { useFoldingPad } from "@/features/write/useFoldingPad";
import type { PreviewStatus } from "@/features/write/useMoneyWrite";
import { useTheme } from "@/theme";
import type { PagerTab } from "@/ui/DetailPager";
import {
	CategoryGlyph,
	categoryColor,
	Glyph,
	type GlyphName,
} from "@/ui/Glyph";
import { ProjectRow } from "@/ui/ProjectRow";
import type { SummaryPart } from "@/ui/SummaryLine";
import { BudgetChanges, BudgetPreviewLine } from "./BudgetChanges";
import { POOL } from "./moveEnds";
import { type BudgetMonth, type BudgetPreview, envelopesOf } from "./source";

// The two ways to move money in the budget (between envelopes, and between an
// envelope and Wealth) are one screen: the amount as the big figure, the two
// ends as one line, the panels under it and the keypad that folds into one
// button. This file is that screen; the forms choose the places and the body.

/** One choice in a panel: an envelope, the pool, or an account. */
export interface Place {
	id: string;
	name: string;
	/** Already worded: "$80 left" or the account's balance. */
	meta: string;
	cover: ReactNode;
}

/** The places a move can name, with their round covers. */
export function usePlaces(data: BudgetMonth) {
	const tb = useTranslations("mobile.budget");
	const money = useMoneyText();
	const { color, radius, size } = useTheme();
	const cover = (inner: ReactNode) => (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				width: size.avatar.md,
				height: size.avatar.md,
				borderRadius: radius.ctl,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: color.raised,
			}}
		>
			{inner}
		</View>
	);
	const glyphCover = (name: GlyphName) =>
		cover(<Glyph color={color.fg2} name={name} size={size.icon.phone} />);
	const poolName = tb(`pool.${data.toAssign.poolName}`);
	const left = (amount: { minor: number; currency: string }) =>
		tb("row.leftSpoken", { amount: money(amount) });
	/** The pool first, then every envelope, each with what is left. */
	const envelopePlaces: Place[] = [
		{
			id: POOL,
			name: poolName,
			meta: left(data.toAssign.amount),
			cover: glyphCover("Coins"),
		},
		...envelopesOf(data).map((e) => ({
			id: e.id,
			name: e.name,
			meta: left(e.left),
			cover: cover(
				<CategoryGlyph
					category={{ name: e.name, icon: e.icon }}
					color={categoryColor(color, categoryTone(e.color ?? ""))}
					size={size.icon.phone}
				/>,
			),
		})),
	];
	return { poolName, envelopePlaces, glyphCover, money };
}

/** One panel of places: a row each, the picked one selected. */
export function PlaceRows({
	label,
	places,
	value,
	onPick,
}: {
	label: string;
	places: Place[];
	value: string;
	onPick: (id: string) => void;
}) {
	const { space } = useTheme();
	return (
		<View accessibilityLabel={label} style={{ gap: space[2] }}>
			{places.map((place) => (
				<ProjectRow
					cover={place.cover}
					faces={[]}
					key={place.id}
					meta={place.meta}
					name={place.name}
					onPress={() => onPick(place.id)}
					selected={value === place.id}
				/>
			))}
		</View>
	);
}

/** The amount of a move: its draft, the folding keypad and the figure's line. */
export function useMoveAmount(currency: string, label: string) {
	const locale = useAmountLocale();
	const [draft, setDraft] = useState("");
	const entered = readAmount(draft, locale, currency);
	const minor = minorOf(entered);
	const pad = useFoldingPad(minor !== null);
	const line = useAmountLine({
		currency,
		text: draft,
		entered,
		label,
		onPress: pad.requestKeypad,
	});
	return { currency, draft, setDraft, entered, minor, pad, line };
}

export type MoveAmount = ReturnType<typeof useMoveAmount>;

/**
 * The frame of a move: the panels the form names, then Changes (the full dry
 * run), over the keypad and one button. The dry run is also said in one line
 * under the figure.
 */
export function MoneyMoveFrame({
	data,
	amount,
	flow,
	ready,
	onSubmit,
	add,
	panels,
	summary,
	header = null,
}: {
	data: BudgetMonth;
	amount: MoveAmount;
	flow: {
		preview: BudgetPreview | null;
		status: PreviewStatus;
		committing: boolean;
		commitFailed: boolean;
	};
	ready: boolean;
	onSubmit: () => void;
	/** The button's words: what it says, what a screen reader says, and folded. */
	add: { label: string; description: string; folded: string };
	/** The panels before Changes: their tab word, glyph and rows. */
	panels: {
		key: string;
		label: string;
		icon: PagerTab["icon"];
		node: ReactNode;
	}[];
	summary: SummaryPart[];
	header?: ReactNode;
}) {
	const tm = useTranslations("mobile.budget.move");
	const tb = useTranslations("mobile.budget");
	const tc = useTranslations("mobile.composer");
	const { space } = useTheme();
	const { pad, line, draft, setDraft, entered, currency } = amount;
	const tabs: PagerTab[] = [
		...panels.map(({ key, label, icon }) => ({ key, label, icon })),
		{ key: "changes", label: tm("changes"), icon: "ListChecks" },
	];
	const nodes = [
		...panels.map((panel) => <View key={panel.key}>{panel.node}</View>),
		<View key="changes" style={{ gap: space[2] }}>
			<BudgetChanges data={data} preview={flow.preview} status={flow.status} />
			{flow.commitFailed ? (
				<Note tone="attention">{tb("write.error")}</Note>
			) : null}
		</View>,
	];
	return (
		<ComposerFrame
			add={{
				onPress: onSubmit,
				...add,
				off: !ready,
				busy: flow.committing,
			}}
			amount={
				<AmountEntry
					below={
						<BudgetPreviewLine
							data={data}
							preview={flow.preview}
							status={flow.status}
						/>
					}
					currency={currency}
					error={entered.state === "invalid"}
					line={line}
					onFocusChange={pad.setTyping}
					onPress={pad.requestKeypad}
					onText={setDraft}
					padOpen={pad.padOpen}
					system={pad.system}
					text={draft}
					typing={pad.typing}
				/>
			}
			changedLabel={tc("tabs.changed")}
			header={header}
			keypad={{ text: draft, currency, kind: "money", onChange: setDraft }}
			keypadOpen={pad.padOpen}
			onPageChange={(next) => pad.goTo(next)}
			onScrollDrag={() => {
				if (pad.system) pad.setPadOpen(false);
			}}
			page={pad.page}
			panels={nodes}
			preview={null}
			summary={summary}
			surface
			tabs={tabs}
			tabsLabel={tc("tabs.label")}
			title={null}
			typing={pad.typing}
		/>
	);
}
