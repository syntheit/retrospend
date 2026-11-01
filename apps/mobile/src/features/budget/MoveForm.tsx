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
import { useMoneyWrite, useWriteIds } from "@/features/write/useMoneyWrite";
import { useUndoToast } from "@/features/write/useUndoToast";
import { noSession, useApi } from "@/features/write/WriteFrame";
import type { FormProps } from "@/features/write/WriteFrame";
import { useTheme } from "@/theme";
import type { PagerTab } from "@/ui/DetailPager";
import { CategoryGlyph, categoryColor, Glyph } from "@/ui/Glyph";
import { ProjectRow } from "@/ui/ProjectRow";
import { moveRequest } from "./bodies";
import {
	BudgetChanges,
	BudgetPreviewLine,
} from "./BudgetChanges";
import { firstEnds, type MoveEnds, pickEnd, POOL, readEnds } from "./moveEnds";
import { changesAnything } from "./preview";
import { envelopesOf } from "./source";

const PANELS = ["from", "to", "changes"] as const;
type PanelName = (typeof PANELS)[number];
const PANEL_ICON = {
	from: "ArrowUpFromLine",
	to: "ArrowDownToLine",
	changes: "ListChecks",
} as const;

/** One place money can leave or land: the pool or an envelope. */
interface Place {
	id: string;
	name: string;
	/** Already worded: "$80 left". */
	meta: string;
	cover: ReactNode;
}

/**
 * Move money in the transfer's shape: the amount as the big figure, the two
 * ends as one line ("Not planned yet → Groceries") and the panels From, To
 * and Changes under it, over the keypad that folds into one Move money
 * button. The envelope the sheet was opened from is always one end; picking it
 * on the other side turns the move around. Money from the pool into an
 * envelope is an assign, every other move is a move (the same split as the
 * web). Previewed in one line (the full block is on the Changes tab), then
 * undone from the toast.
 */
export function MoveForm({ data, envelope, month, onDone, onClose }: FormProps) {
	const t = useTranslations("mobile.budget.move");
	const tb = useTranslations("mobile.budget");
	const tc = useTranslations("mobile.composer");
	const money = useMoneyText();
	const locale = useAmountLocale();
	const api = useApi();
	const announce = useUndoToast("budget");
	const { color, radius, size, space } = useTheme();
	const currency = data.book.currency;
	const poolName = tb(`pool.${data.toAssign.poolName}`);

	const [ends, setEnds] = useState<MoveEnds>(() =>
		firstEnds(envelope.id, [
			{ id: POOL, minor: data.toAssign.amount.minor },
			...envelopesOf(data).map((e) => ({ id: e.id, minor: e.left.minor })),
		]),
	);
	const [page, setPage] = useState(0);
	const [draft, setDraft] = useState("");

	const entered = readAmount(draft, locale, currency);
	const minor = minorOf(entered);
	const pad = useFoldingPad(minor !== null);
	const line = useAmountLine({
		currency,
		text: draft,
		entered,
		label: t("amount"),
		onPress: () => pad.setPadOpen(true),
	});

	const envelopes = envelopesOf(data);
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
	const everyPlace: Place[] = [
			{
				id: POOL,
				name: poolName,
				meta: tb("row.leftSpoken", { amount: money(data.toAssign.amount) }),
				cover: cover(
					<Glyph color={color.fg2} name="Coins" size={size.icon.phone} />,
				),
			},
			...envelopes.map((e) => ({
				id: e.id,
				name: e.name,
				meta: tb("row.leftSpoken", { amount: money(e.left) }),
				cover: cover(
					<CategoryGlyph
						category={{ name: e.name, icon: e.icon }}
						color={categoryColor(color, categoryTone(e.color ?? ""))}
						size={size.icon.phone}
					/>,
				),
			})),
	];
	const placeOf = (id: string) => everyPlace.find((p) => p.id === id);
	const left = new Map<string, number>([
		[POOL, data.toAssign.amount.minor],
		...envelopes.map((e) => [e.id, e.left.minor] as [string, number]),
	]);
	// Money can only come from a place that has some (this envelope can always
	// be the one that gives); it can go anywhere.
	const fromPlaces = everyPlace.filter(
		(p) =>
			p.id === envelope.id || p.id === ends.from || (left.get(p.id) ?? 0) > 0,
	);

	const read = readEnds(ends, envelope.id);
	const bodyKey =
		minor === null || !read
			? null
			: JSON.stringify({ ends, minor, month });
	const { idFor } = useWriteIds(bodyKey);
	const request =
		minor === null || !read
			? null
			: moveRequest({
					batchId: idFor("batch"),
					itemId: idFor("item"),
					month,
					envelopeId: envelope.id,
					direction: read.direction,
					peer: read.peer,
					minor,
					currency,
				});
	const idempotencyKey = request
		? request.send === "assign"
			? request.body.batchId
			: request.body.id
		: null;

	const flow = useMoneyWrite({
		input: request,
		idempotencyKey,
		preview: (req) =>
			api
				? req.send === "assign"
					? api.budget.previewAssign(req.body)
					: api.budget.previewMove(req.body)
				: noSession(),
		write: (req, key) => {
			if (!api) return noSession();
			const options = { context: { idempotencyKey: key } };
			return req.send === "assign"
				? api.budget.assign(req.body, options)
				: api.budget.move(req.body, options);
		},
	});
	const ready =
		flow.status === "ready" &&
		flow.preview !== null &&
		changesAnything(flow.preview);

	async function submit() {
		const out = await flow.commit();
		if (!out || minor === null || !read) return;
		const other = placeOf(read.direction === "in" ? ends.from : ends.to);
		const amount = money({ minor, currency });
		announce({
			message:
				read.direction === "in"
					? t("toastIn", {
							amount,
							other: other?.name ?? "",
							name: envelope.name,
						})
					: t("toastOut", {
							amount,
							other: other?.name ?? "",
							name: envelope.name,
						}),
			token: out.undo,
			onChanged: onDone,
		});
		onClose();
	}

	const patch = (next: MoveEnds) => {
		setEnds(next);
		pad.fold();
	};
	const goTo = (next: number) => {
		setPage(next);
		pad.fold();
	};

	const labels: Record<PanelName, string> = {
		from: t("from"),
		to: t("to"),
		changes: t("changes"),
	};
	const tabs: PagerTab[] = PANELS.map((name) => ({
		key: name,
		label: labels[name],
		icon: PANEL_ICON[name],
	}));
	const rowsOf = (
		places: Place[],
		value: string,
		side: "from" | "to",
	): ReactNode => (
		<View accessibilityLabel={labels[side]} style={{ gap: space[2] }}>
			{places.map((place) => (
				<ProjectRow
					cover={place.cover}
					faces={[]}
					key={place.id}
					meta={place.meta}
					name={place.name}
					onPress={() => patch(pickEnd(ends, side, place.id, envelope.id))}
					selected={value === place.id}
				/>
			))}
		</View>
	);
	const panels = [
		<View key="from">{rowsOf(fromPlaces, ends.from, "from")}</View>,
		<View key="to">{rowsOf(everyPlace, ends.to, "to")}</View>,
		<View key="changes" style={{ gap: space[2] }}>
			<BudgetChanges data={data} preview={flow.preview} status={flow.status} />
			{flow.commitFailed ? (
				<Note tone="attention">{tb("write.error")}</Note>
			) : null}
		</View>,
	];

	const fromName = placeOf(ends.from)?.name ?? "";
	const toName = placeOf(ends.to)?.name ?? "";
	const summary = [
		{
			key: "ends",
			text: `${fromName} → ${toName}`,
			active: page <= 1,
			onPress: () => goTo(0),
		},
	];

	return (
		<ComposerFrame
			add={{
				onPress: submit,
				label: t("add"),
				description: t("submit"),
				folded: t("submit"),
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
					onPress={() => pad.setPadOpen(true)}
					onText={setDraft}
					padOpen={pad.padOpen}
					system={pad.system}
					text={draft}
					typing={pad.typing}
				/>
			}
			changedLabel={tc("tabs.changed")}
			header={null}
			keypad={{
				text: draft,
				currency,
				kind: "money",
				onChange: setDraft,
			}}
			keypadOpen={pad.padOpen}
			onPageChange={(next) => goTo(next)}
			onScrollDrag={() => {
				if (pad.system) pad.setPadOpen(false);
			}}
			page={page}
			panels={panels}
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
