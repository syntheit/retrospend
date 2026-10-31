import { View } from "react-native";
import { useTranslations } from "use-intl";
import { Cover } from "@/features/projects/Cover";
import { useTheme } from "@/theme";
import type { Face } from "@/ui/Avatar";
import { Glyph } from "@/ui/Glyph";
import { ProjectRow } from "@/ui/ProjectRow";
import { usePersonFaces } from "./Face";
import type { EntryProject } from "./types";

/**
 * The project, in place: Personal, then one row for each project you can add
 * to, with its cover, its name on one line, a small stack of its people and
 * "4 people · USD". Picking one takes in its people and its currency. A saved
 * expense keeps its project: the panel shows it and does not move it.
 */
export function ProjectPanel({
	projects,
	value,
	editing,
	onPick,
}: {
	projects: EntryProject[];
	value: string | null;
	/** A saved expense never moves between projects. */
	editing: boolean;
	onPick: (projectId: string | null) => void;
}) {
	const t = useTranslations("mobile.composer");
	const tp = useTranslations("mobile.projects");
	const { color, radius, size, space } = useTheme();
	const faces = usePersonFaces();
	const meta = (p: EntryProject) =>
		`${tp("peopleCount", { count: p.peopleCount })} · ${p.currency}`;
	const rows = editing ? projects.filter((p) => p.id === value) : projects;
	const personal = (
		<ProjectRow
			accessibilityLabel={`${t("context.personal")}, ${t("project.onlyYou")}`}
			cover={
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
					<Glyph color={color.fg2} name="User" size={size.icon.phone} />
				</View>
			}
			faces={[]}
			meta={t("project.onlyYou")}
			name={t("context.personal")}
			onPress={editing ? undefined : () => onPick(null)}
			selected={value === null}
		/>
	);
	return (
		<View style={{ gap: space[2] }}>
			{editing && value !== null ? null : personal}
			{rows.map((p) => {
				const people: Face[] = faces(
					p.people.map((m) => ({
						key: m.id,
						name: m.name,
						imageUrl: m.imageUrl,
					})),
				);
				return (
					<ProjectRow
						cover={
							<Cover
								diameter={size.avatar.md}
								id={p.id}
								imageUri={p.imageUrl}
								name={p.name}
							/>
						}
						faces={people}
						key={p.id}
						meta={meta(p)}
						name={p.name}
						onPress={editing ? undefined : () => onPick(p.id)}
						selected={value === p.id}
					/>
				);
			})}
		</View>
	);
}
