import { type ReactNode, useState } from "react";
import { Text, View } from "react-native";
import { ActivityRow } from "@/features/activity/ActivityRow";
import type { ActivityItem } from "@/features/activity/source";
import { useTheme } from "@/theme";
import { AddButton } from "@/ui/AddButton";
import { EmptyState } from "@/ui/EmptyState";
import { Menu } from "@/ui/Menu";
import { Money } from "@/ui/Money";
import { MoneyKeypad } from "@/ui/MoneyKeypad";
import { Picker } from "@/ui/Picker";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Sheet } from "@/ui/Sheet";
import { SwipeRow } from "@/ui/SwipeRow";
import { useToast } from "@/ui/Toast";
import { TopBar } from "@/ui/TopBar";

// Development only (flags.ts): every platform component in one place, with
// sample values. These are not product data and never reach a release build.

const SAMPLE: ActivityItem = {
	id: "sample",
	title: "Coffee with Lucia",
	subline: "Food, Oct 21",
	amount: { minor: 1250000, currency: "ARS" },
	version: "sample",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
	const { color, space, type } = useTheme();
	return (
		<View style={{ gap: space[2] }}>
			<Text
				accessibilityRole="header"
				style={{
					color: color.fg,
					fontSize: type.section.size,
					fontWeight: "600",
				}}
			>
				{title}
			</Text>
			{children}
		</View>
	);
}

export default function GalleryScreen() {
	const { color, space, type } = useTheme();
	const toast = useToast();
	const [sheet, setSheet] = useState(false);
	const [period, setPeriod] = useState<"week" | "month" | "year">("month");
	const [currency, setCurrency] = useState<"ARS" | "USD" | "EUR">("ARS");
	const [draft, setDraft] = useState("");
	const [expanded, setExpanded] = useState(true);
	const note = (text: string) =>
		toast.show({ message: text, undo: { label: "Undo", onUndo: () => {} } });

	return (
		<>
			<TopBar accountInitials="DM" accountLabel="Account" title="Gallery" />
			<Screen>
				<Section title="Money">
					<View style={{ gap: space[1] }}>
						<Money value={{ minor: 1250000, currency: "ARS" }} />
						<Money tone="positive" value={{ minor: 5190, currency: "BRL" }} />
						<Money tone="muted" value={{ minor: 299, currency: "USD" }} />
						<Money fallback="No rate yet" value={null} />
					</View>
				</Section>
				<Section title="Segmented">
					<Segmented
						accessibilityLabel="Period"
						onChange={setPeriod}
						options={[
							{ value: "week", label: "Week" },
							{ value: "month", label: "Month" },
							{ value: "year", label: "Year" },
						]}
						value={period}
					/>
				</Section>
				<Section title="Picker">
					<Picker
						onChange={setCurrency}
						options={[
							{ value: "ARS", label: "ARS" },
							{ value: "USD", label: "USD" },
							{ value: "EUR", label: "EUR" },
						]}
						value={currency}
					/>
				</Section>
				<Section title="Menu">
					<Menu
						items={[
							{ id: "edit", label: "Edit", onPress: () => note("Edit") },
							{
								id: "delete",
								label: "Delete",
								destructive: true,
								onPress: () => note("Expense deleted"),
							},
						]}
						label="More"
					/>
				</Section>
				<Section title="Swipe row, long press for the menu">
					<SwipeRow
						leading={{
							label: "Split",
							tone: "brand",
							onPress: () => note("Split opened"),
						}}
						menu={[
							{ id: "split", label: "Split", onPress: () => note("Split") },
							{
								id: "delete",
								label: "Delete",
								destructive: true,
								onPress: () => note("Expense deleted"),
							},
						]}
						menuTitle={SAMPLE.title}
						trailing={{
							label: "Delete",
							tone: "danger",
							onPress: () => note("Expense deleted"),
						}}
					>
						<ActivityRow item={SAMPLE} />
					</SwipeRow>
				</Section>
				<Section title="Sheet">
					<Menu
						items={[
							{
								id: "open",
								label: "Open the sheet",
								onPress: () => setSheet(true),
							},
						]}
						label="Sheet"
					/>
					<Sheet
						detents={["medium", "large"]}
						onClose={() => setSheet(false)}
						title="Sheet title"
						visible={sheet}
					>
						<Text style={{ color: color.fg2, fontSize: type.body.size }}>
							Detents on iOS, a modal bottom sheet on Android.
						</Text>
					</Sheet>
				</Section>
				<Section title="Toast with Undo">
					<Menu
						items={[
							{
								id: "toast",
								label: "Show a toast",
								onPress: () => note("Expense added"),
							},
						]}
						label="Toast"
					/>
				</Section>
				<Section title="Add button">
					<AddButton
						actions={[
							{ id: "income", label: "Add income", onPress: () => {} },
							{ id: "transfer", label: "Transfer", onPress: () => {} },
						]}
						expanded={expanded}
						label="Add expense"
						onPress={() => setExpanded((value) => !value)}
					/>
				</Section>
				<Section title="Money keypad">
					<Text
						style={{
							color: color.fg,
							fontSize: type.title.size,
							fontVariant: ["tabular-nums"],
							fontWeight: "600",
						}}
					>
						{draft ? `ARS ${draft}` : "ARS 0"}
					</Text>
					<MoneyKeypad currency="ARS" draft={draft} onDraftChange={setDraft} />
				</Section>
				<Section title="Empty state">
					<EmptyState
						actionLabel="Add expense"
						onAction={() => {}}
						title="No expenses yet"
					/>
				</Section>
			</Screen>
		</>
	);
}
