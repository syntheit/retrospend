import { type ReactNode, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, View } from "react-native";
import { useTranslations } from "use-intl";
import { Cover } from "@/features/projects/Cover";
import { useTheme } from "@/theme";
import { ListGroup, ListRow, SectionHeader } from "@/ui/List";
import { Text } from "@/ui/Text";
import { ChangesBlock } from "./ChangesBlock";
import { DateRow, GroupItem } from "./DateRow";
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
 * project, how it is split, the rate, and the full list of what this changes.
 * The Details (note, place, spread, exclude) stay on the quick step. An edit
 * of an expense ends with Delete. Income and Transfer keep their own few
 * rows.
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
	/** The Delete row opens its confirm; null when it is not offered. */
	onDelete: (() => void) | null;
}) {
	const t = useTranslations("mobile.composer");
	const { size, space } = useTheme();
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
	const editing = draft.editing !== null;
	const projects = editing ? [] : catalog.projects;
	// A saved expense keeps its project (the server does not move it): a plain row.
	const kept = editing
		? catalog.projects.find((p) => p.id === draft.projectId)
		: undefined;
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
					{kept ? (
						<ListRow
							accessibilityLabel={`${t("project.label")}, ${kept.name}`}
							end={
								<View
									style={{
										flexDirection: "row",
										alignItems: "center",
										gap: space[2],
									}}
								>
									<Cover
										diameter={size.avatar.sm}
										id={kept.id}
										imageUri={kept.imageUrl}
										name={kept.name}
									/>
									<Text numberOfLines={1} tone="fg2">
										{kept.name}
									</Text>
								</View>
							}
							title={t("project.label")}
						/>
					) : null}
				</ListGroup>
			</View>
			{split ? (
				<SplitGroup form={form} preview={preview} split={split} />
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
			{changes}
			{onDelete ? (
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
