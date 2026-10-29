import { type ReactNode, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { ListGroup, ListRow, SectionHeader } from "@/ui/List";
import { SwitchRow } from "@/ui/SwitchRow";
import { Text } from "@/ui/Text";
import { FieldLabel, TextField } from "@/ui/TextField";
import { ChangesBlock } from "./ChangesBlock";
import { DateRow, GroupItem } from "./DateRow";
import {
	isPersonal,
	LOCATION_LIMIT,
	NOTE_LIMIT,
	SHARED_NOTE_LIMIT,
	SPREAD_MONTHS,
} from "./draft";
import type { SavedEntry } from "./hooks";
import { IncomeDetails } from "./IncomeFields";
import { PlanBlock } from "./PlanBlock";
import { ProjectPick } from "./ProjectPick";
import { SplitGroup, useSplitView } from "./SplitGroup";
import { TransferDetails } from "./TransferFields";
import type { ComposerPreview } from "./useComposerPreview";
import type { EntryForm } from "./useEntryForm";

/**
 * A step slides in from the side over the sheet duration; with reduced
 * motion it only fades. `animate` is false for the first quick step, which
 * is simply there when the composer opens.
 */
export function StepSlide({
	animate,
	from,
	children,
}: {
	animate: boolean;
	/** 1 comes in from the end (More), -1 from the start (back to the quick step). */
	from: 1 | -1;
	children: ReactNode;
}) {
	const { duration, space } = useTheme();
	const progress = useRef(new Animated.Value(animate ? 0 : 1)).current;
	const [still, setStill] = useState(false);
	useEffect(() => {
		AccessibilityInfo.isReduceMotionEnabled().then(setStill);
	}, []);
	useEffect(() => {
		if (!animate) return;
		Animated.timing(progress, {
			toValue: 1,
			duration: duration.sheet,
			useNativeDriver: true,
		}).start();
	}, [animate, progress, duration.sheet]);
	return (
		<Animated.View
			style={{
				flex: 1,
				opacity: progress,
				transform: still
					? []
					: [
							{
								translateX: progress.interpolate({
									inputRange: [0, 1],
									outputRange: [space[6] * from, 0],
								}),
							},
						],
			}}
		>
			{children}
		</Animated.View>
	);
}

/**
 * Everything the quick step leaves out, in inset groups: the day and the
 * project, how it is split, the rate, the options, the note and place, and
 * the full list of what this changes. An edit ends with Delete. Income and
 * Transfer keep their own few rows.
 */
export function MoreStep({
	form,
	preview,
	edit,
	rate,
	onDelete,
}: {
	form: EntryForm;
	preview: ComposerPreview;
	edit: SavedEntry | undefined;
	/** The rate line for an amount in another currency; null at home. */
	rate: ReactNode;
	/** An edit's Delete row opens its confirm. */
	onDelete: () => void;
}) {
	const t = useTranslations("mobile.composer");
	const { space } = useTheme();
	const { mode, catalog } = form;
	const split = useSplitView(form, preview, edit);
	const gutter = { paddingHorizontal: space[4] } as const;
	const changes = (
		<View style={{ ...gutter, paddingTop: space[6] }}>
			<ChangesBlock
				idle={
					mode === "expense"
						? t("changes.emptyExpense")
						: mode === "income"
							? t("changes.emptyIncome")
							: t("changes.emptyTransfer")
				}
				onRetry={preview.retry}
				state={preview.preview}
			/>
		</View>
	);
	const plan = preview.plan ? (
		<View style={{ ...gutter, paddingTop: space[4] }}>
			<PlanBlock plan={preview.plan} />
		</View>
	) : null;

	if (mode === "income") {
		return (
			<View>
				<IncomeDetails
					catalog={catalog}
					draft={form.income}
					onChange={form.patchIncome}
					onTypingChange={form.setTyping}
				/>
				{rate ? (
					<>
						<SectionHeader title={t("rate.title")} />
						<ListGroup>
							<GroupItem>{rate}</GroupItem>
						</ListGroup>
					</>
				) : null}
				{changes}
				{plan}
			</View>
		);
	}
	if (mode === "transfer") {
		return (
			<View>
				<TransferDetails
					draft={form.transfer}
					onChange={form.patchTransfer}
					onTypingChange={form.setTyping}
				/>
				{changes}
			</View>
		);
	}

	const draft = form.expense;
	const personal = isPersonal(draft);
	const editing = draft.editing !== null;
	const projects = editing ? [] : catalog.projects;
	// A saved odd spread (say 4 months) stays offered next to the usual ones.
	const months = [
		...new Set([...SPREAD_MONTHS, ...(draft.spread ? [draft.spread] : [])]),
	].sort((a, b) => a - b);
	return (
		<View>
			<View style={{ paddingTop: space[1] }}>
				<ListGroup>
					<DateRow
						label={t("dateField")}
						onChange={(date) => form.patchExpense({ date })}
						value={draft.date}
					/>
					{projects.length > 0 ? (
						<ProjectPick
							onChange={form.pickProject}
							projects={projects}
							value={draft.projectId}
							variant="row"
						/>
					) : null}
				</ListGroup>
			</View>
			{split ? (
				<SplitGroup split={split} />
			) : draft.withKeys.length === 0 && !editing ? (
				<View style={{ ...gutter, paddingTop: space[2] }}>
					<Text tone="fg2" variant="small">
						{t("split.tapFaces")}
					</Text>
				</View>
			) : null}
			{rate ? (
				<>
					<SectionHeader title={t("rate.title")} />
					<ListGroup>
						<GroupItem>{rate}</GroupItem>
					</ListGroup>
				</>
			) : null}
			{personal ? (
				<>
					<SectionHeader title={t("options")} />
					<ListGroup>
						<GroupItem>
							<View style={{ gap: space[2] }}>
								<FieldLabel>{t("spread")}</FieldLabel>
								<View
									accessibilityLabel={t("spread")}
									accessibilityRole="radiogroup"
									style={{
										flexDirection: "row",
										flexWrap: "wrap",
										gap: space[2],
									}}
								>
									<Chip
										label={t("spreadOne")}
										onPress={() => form.patchExpense({ spread: null })}
										selected={draft.spread === null}
									/>
									{months.map((count) => (
										<Chip
											key={count}
											label={t("spreadMonths", { count })}
											onPress={() => form.patchExpense({ spread: count })}
											selected={draft.spread === count}
										/>
									))}
								</View>
							</View>
						</GroupItem>
						<GroupItem>
							<View>
								<SwitchRow
									detail={
										draft.excludeAuto && draft.exclude
											? t("excludeAuto")
											: t("excludeDetail")
									}
									label={t("exclude")}
									onChange={(exclude) =>
										form.patchExpense({
											exclude,
											excludeTouched: true,
											excludeAuto: false,
										})
									}
									value={draft.exclude}
								/>
							</View>
						</GroupItem>
					</ListGroup>
				</>
			) : null}
			<SectionHeader title={t("details")} />
			<View style={{ ...gutter, gap: space[3] }}>
				<TextField
					autoCapitalize="sentences"
					label={t("note")}
					maxLength={personal ? NOTE_LIMIT : SHARED_NOTE_LIMIT}
					onChangeText={(note) => form.patchExpense({ note })}
					onTypingChange={form.setTyping}
					placeholder={t("notePlaceholder")}
					value={draft.note}
				/>
				{personal ? (
					<TextField
						autoCapitalize="sentences"
						label={t("location")}
						maxLength={LOCATION_LIMIT}
						onChangeText={(location) => form.patchExpense({ location })}
						onTypingChange={form.setTyping}
						placeholder={t("locationPlaceholder")}
						value={draft.location}
					/>
				) : null}
			</View>
			{changes}
			{editing ? (
				<View style={{ paddingTop: space[6] }}>
					<ListGroup>
						<ListRow onPress={onDelete}>
							<Text tone="danger" weight="medium">
								{t("delete.row")}
							</Text>
						</ListRow>
					</ListGroup>
				</View>
			) : null}
		</View>
	);
}
