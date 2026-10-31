import { type ReactNode, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { GroupItem, ListGroup, SectionHeader } from "@/ui/List";
import { ChangesBlock } from "./ChangesBlock";
import { IncomeDetails } from "./IncomeFields";
import { PlanBlock } from "./PlanBlock";
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
 * What the quick step of Add income and Add transfer leaves out, in inset
 * groups: the day, the plan, the rate, and the full list of what this
 * changes. (An expense has no More step: its details are the panels of the
 * detail pager.)
 */
export function MoreStep({
	form,
	preview,
	rate,
}: {
	form: EntryForm;
	preview: ComposerPreview;
	/** The rate line for an amount in another currency; null at home. */
	rate: ReactNode;
}) {
	const t = useTranslations("mobile.composer");
	const { space } = useTheme();
	const { mode, catalog } = form;
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
	return (
		<View>
			<TransferDetails draft={form.transfer} onChange={form.patchTransfer} />
			{changes}
		</View>
	);
}
