import { useLocalSearchParams } from "expo-router";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { ActivityRow } from "@/features/activity/ActivityRow";
import type { ActivityItem } from "@/features/activity/source";
import { useTheme } from "@/theme";
import { AddButton } from "@/ui/AddButton";
import { EmptyState } from "@/ui/EmptyState";
import { Menu } from "@/ui/Menu";
import { MoneyAmount } from "@/ui/Money";
import { MoneyKeypad } from "@/ui/MoneyKeypad";
import { Picker } from "@/ui/Picker";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Sheet } from "@/ui/Sheet";
import { SwipeRow } from "@/ui/SwipeRow";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { TopBar } from "@/ui/TopBar";

// Development only (flags.ts): every platform component in one place, with
// sample values. These are not product data and never reach a release build.

const SAMPLE: ActivityItem = {
	id: "sample",
	source: "personal",
	entityId: "sample",
	kind: "expense",
	title: "Coffee with Lucia",
	category: { id: "sample", name: "Food", icon: null, tone: 3 },
	amount: { minor: 1250000, currency: "ARS" },
	sortKey: 1250000,
	project: null,
	date: "2026-10-21",
	mine: true,
	locked: false,
	canEdit: true,
};

function Section({ title, children }: { title: string; children: ReactNode }) {
	const { space } = useTheme();
	return (
		<View style={{ gap: space[2] }}>
			<Text accessibilityRole="header" variant="section">
				{title}
			</Text>
			{children}
		</View>
	);
}

export default function GalleryScreen() {
	const { space } = useTheme();
	const toast = useToast();
	const [sheet, setSheet] = useState(false);
	const [period, setPeriod] = useState<"week" | "month" | "year">("month");
	const [currency, setCurrency] = useState<"ARS" | "USD" | "EUR">("ARS");
	const [draft, setDraft] = useState("");
	const [expanded, setExpanded] = useState(true);
	// The long gallery is two pages; page 2 holds the lower sections.
	const second = useLocalSearchParams<{ page?: string }>().page === "2";
	const note = (text: string) =>
		toast.show({ message: text, undo: { label: "Undo", onUndo: () => {} } });

	return (
		<>
			<TopBar
				account={{ key: "user:gallery", name: "Daniel M", imageUri: null }}
				accountLabel="Account"
				title="Gallery"
			/>
			<Screen>
				{second ? null : (
					<>
						<Section title="Type">
							<View style={{ gap: space[1] }}>
								<Text variant="hero">Hero, 32 semibold</Text>
								<Text variant="title">Title, 22 semibold</Text>
								<Text variant="section">Section, 16 semibold</Text>
								<Text>Body, 14 regular</Text>
								<Text weight="medium">Body, 14 medium</Text>
								<Text tone="fg2" variant="small">
									Small, 13 in fg-2
								</Text>
								<Text tone="fg3" variant="meta">
									Meta, 12 in fg-3
								</Text>
								<Text tone="positive" variant="small">
									Owes you
								</Text>
								<Text tone="attention" variant="small">
									Over by
								</Text>
								<Text tone="danger" variant="small">
									Could not save
								</Text>
							</View>
						</Section>
						<Section title="Money">
							<View style={{ gap: space[1] }}>
								<MoneyAmount value={{ minor: 1250000, currency: "ARS" }} />
								<MoneyAmount
									tone="positive"
									value={{ minor: 5190, currency: "BRL" }}
								/>
								<MoneyAmount
									tone="muted"
									value={{ minor: 299, currency: "USD" }}
								/>
								<MoneyAmount home={null} value={{ minor: 1250, currency: "EUR" }} />
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
					</>
				)}
				{second ? (
					<>
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
								<Text tone="fg2">
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
							<Text tabular variant="title">
								{draft ? `ARS ${draft}` : "ARS 0"}
							</Text>
							<MoneyKeypad
								currency="ARS"
								draft={draft}
								onDraftChange={setDraft}
							/>
						</Section>
						<Section title="Empty state">
							<EmptyState
								actionLabel="Add expense"
								onAction={() => {}}
								title="No expenses yet"
							/>
						</Section>
					</>
				) : null}
			</Screen>
		</>
	);
}
