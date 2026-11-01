import { type ReactElement, useMemo } from "react";
import { useServerBaseUrl } from "@/auth/server-connection";
import { Cover } from "@/features/projects/Cover";
import { absoluteImage } from "@/features/read/faces";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { CategoryGlyph, categoryColor } from "@/ui/Glyph";

/**
 * The identity marks of the filter menus (GUIDELINE 8): a person's face, a
 * category's bare glyph and a project's cover, small enough for a menu item.
 * Activity and Insights share them.
 */
export function useFilterLeads() {
	const { color, size } = useTheme();
	const base = useServerBaseUrl();
	return useMemo(
		() => ({
			category: (category: {
				name: string;
				icon?: string | null;
				tone: number;
			}): ReactElement => (
				<CategoryGlyph
					category={category}
					color={categoryColor(color, category.tone)}
					size={size.icon.phone}
				/>
			),
			person: (
				person: {
					key: string;
					name: string;
					imageUrl?: string | null;
				},
				avatar: "xs" | "sm" = "xs",
			): ReactElement => (
				<Avatar
					face={{
						key: person.key,
						name: person.name,
						imageUri: absoluteImage(person.imageUrl, base),
					}}
					size={avatar}
				/>
			),
			project: (
				project: {
					id: string;
					name: string;
					imageUrl?: string | null;
				},
				avatar: "xs" | "sm" = "xs",
			): ReactElement => (
				<Cover
					diameter={size.avatar[avatar]}
					id={project.id}
					imageUri={absoluteImage(project.imageUrl, base)}
					name={project.name}
				/>
			),
		}),
		[color, size, base],
	);
}
