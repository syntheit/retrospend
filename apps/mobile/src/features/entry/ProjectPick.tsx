import { useTranslations } from "use-intl";
import { Cover } from "@/features/projects/Cover";
import { useTheme } from "@/theme";
import { PickField } from "./PickField";
import type { EntryProject } from "./types";

/**
 * The project an expense goes into, with its cover: the context pill in the
 * composer's head says Personal until one is picked, and the same choice is a
 * row of More. Picking one takes in its people.
 */
export function ProjectPick({
	variant,
	projects,
	value,
	onChange,
}: {
	variant: "pill" | "row";
	projects: EntryProject[];
	value: string | null;
	onChange: (projectId: string | null) => void;
}) {
	const t = useTranslations("mobile.composer");
	const { size } = useTheme();
	return (
		<PickField
			empty={t("project.empty")}
			find={t("project.find")}
			label={t("project.label")}
			none={{
				label: t("project.none"),
				shown: variant === "pill" ? t("context.personal") : t("project.none"),
				lead: null,
			}}
			onChange={onChange}
			rows={projects.map((p) => ({
				id: p.id,
				label: p.name,
				detail: p.currency,
				lead: (
					<Cover
						diameter={size.avatar.sm}
						id={p.id}
						imageUri={p.imageUrl}
						name={p.name}
					/>
				),
			}))}
			title={t("project.label")}
			value={value}
			variant={variant}
		/>
	);
}
