import { ACTIVITY_KINDS } from "@retrospend/api-contract";
import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { usePeopleOverview } from "@/features/people/usePeople";
import { useProjectList } from "@/features/projects/useProjects";
import { useTheme } from "@/theme";
import { CategoryPickerSheet } from "@/ui/CategoryPickerSheet";
import { Menu } from "@/ui/Menu";
import { PickerSheet } from "@/ui/PickerSheet";
import type { PickGroup } from "@/ui/pickGroups";
import { SummaryLine, type SummaryPart } from "@/ui/SummaryLine";
import type { MenuItem } from "@/ui/types";
import {
	type ActivityFilter,
	DEFAULT_FILTER,
	effectivePeriod,
} from "./filter";
import { useFilterLeads } from "./filterLeads";
import { useCategories } from "./useCategories";

type Dimension = "category" | "person" | "project" | "kind";

/**
 * The filter as one plain line, the way the composer says its answers: "This
 * month · Groceries · Martín". The period is always there and flips between
 * this month and all time on a tap; each other part is a filter that is set
 * and opens its picker to change it. A Filter menu at the end adds one that is
 * not set yet, and Clear takes them all off. The search bar is the screen
 * header's (native).
 */
export function ActivityFilters({
	filter,
	onChange,
}: {
	filter: ActivityFilter;
	onChange: (next: ActivityFilter) => void;
}) {
	const t = useTranslations("mobile.activity");
	const tp = useTranslations("mobile.pickers");
	const { space } = useTheme();
	const categories = useCategories();
	const people = usePeopleOverview();
	const projects = useProjectList();
	const leads = useFilterLeads();
	const [open, setOpen] = useState<Dimension | null>(null);

	const categoryList =
		categories.state.status === "ready" ? categories.state.data : [];
	const peopleList =
		people.state.status === "ready" ? people.state.data.people : [];
	const projectList =
		projects.state.status === "ready" ? projects.state.data.items : [];
	const category = categoryList.find((c) => c.id === filter.categoryId);
	const person = peopleList.find((p) => p.person.key === filter.personKey);
	const project = projectList.find((p) => p.id === filter.projectId);

	// What the list really covers: a search or a category lists every month.
	const period = effectivePeriod(filter);
	const parts: SummaryPart[] = [
		{
			key: "period",
			text: t(`period.${period}`),
			accessibilityLabel: t("chip.periodSpoken", {
				value: t(`period.${period}`),
			}),
			// All time becomes this month, asked for on purpose, and back.
			onPress: () =>
				onChange({
					...filter,
					period: period === "all" ? "thisMonth" : "all",
				}),
		},
	];
	if (category) {
		parts.push({
			key: "category",
			text: category.name,
			onPress: () => setOpen("category"),
		});
	}
	if (person) {
		parts.push({
			key: "person",
			text: person.person.name,
			onPress: () => setOpen("person"),
		});
	}
	if (project) {
		parts.push({
			key: "project",
			text: project.name,
			onPress: () => setOpen("project"),
		});
	}
	if (filter.kind) {
		parts.push({
			key: "kind",
			text: t(`kind.${filter.kind}`),
			onPress: () => setOpen("kind"),
		});
	}
	const anySet =
		category || person || project || filter.kind || filter.period !== "month";
	if (anySet) {
		parts.push({
			key: "clear",
			text: t("chip.reset"),
			onPress: () =>
				onChange({ ...DEFAULT_FILTER, q: filter.q }),
		});
	}

	// Adding a filter that is not set yet: the menu closes, then its picker opens.
	const add = (dimension: Dimension) => () => setTimeout(() => setOpen(dimension), 0);
	const addItems: MenuItem[] = [
		...(category
			? []
			: [{ id: "category", label: t("chip.category"), onPress: add("category") }]),
		...(person
			? []
			: [{ id: "person", label: t("chip.person"), onPress: add("person") }]),
		...(project
			? []
			: [{ id: "project", label: t("chip.project"), onPress: add("project") }]),
		...(filter.kind
			? []
			: [{ id: "kind", label: t("chip.type"), onPress: add("kind") }]),
	];

	const close = () => setOpen(null);
	const group = (
		title: string,
		rows: PickGroup["rows"],
	): PickGroup[] => [{ key: "all", heading: title, rows }];

	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: space[3],
				paddingHorizontal: space[4],
				paddingVertical: space[2],
			}}
		>
			<View style={{ flex: 1, minWidth: 0 }}>
				<SummaryLine align="start" parts={parts} />
			</View>
			{addItems.length > 0 ? (
				<Menu chip items={addItems} label={t("chip.filter")} />
			) : null}
			<CategoryPickerSheet
				categories={categoryList.map((c) => ({ ...c, icon: c.icon ?? null }))}
				onChange={(id) => onChange({ ...filter, categoryId: id })}
				onClose={close}
				value={filter.categoryId}
				visible={open === "category"}
			/>
			<PickerSheet
				clear={tp("clear")}
				empty={t("filters.noPerson")}
				find={t("filters.findPerson")}
				groups={group(
					t("chip.person"),
					peopleList.map((p) => ({
						id: p.person.key,
						label: p.person.name,
						lead: leads.person(p.person, "sm"),
						selected: p.person.key === filter.personKey,
					})),
				)}
				onClose={close}
				onSelect={(id) => onChange({ ...filter, personKey: id })}
				title={t("chip.person")}
				visible={open === "person"}
			/>
			<PickerSheet
				clear={tp("clear")}
				empty={t("filters.noProject")}
				find={t("filters.findProject")}
				groups={group(
					t("chip.project"),
					projectList.map((p) => ({
						id: p.id,
						label: p.name,
						lead: leads.project(p, "sm"),
						selected: p.id === filter.projectId,
					})),
				)}
				onClose={close}
				onSelect={(id) => onChange({ ...filter, projectId: id })}
				title={t("chip.project")}
				visible={open === "project"}
			/>
			<PickerSheet
				clear={tp("clear")}
				empty={t("filters.noType")}
				find={t("filters.findType")}
				groups={group(
					t("chip.type"),
					ACTIVITY_KINDS.map((kind) => ({
						id: kind,
						label: t(`kind.${kind}`),
						lead: null,
						selected: kind === filter.kind,
					})),
				)}
				onClose={close}
				onSelect={(id) =>
					onChange({
						...filter,
						kind: ACTIVITY_KINDS.find((k) => k === id) ?? null,
					})
				}
				title={t("chip.type")}
				visible={open === "kind"}
			/>
		</View>
	);
}
