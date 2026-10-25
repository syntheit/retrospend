import { Image, Text, View } from "react-native";
import { useTheme } from "@/theme";

/**
 * A person's face: their picture when the server sent an absolute address,
 * else initials on one of the eight avatar colors, picked from the person's
 * key so the same person is the same color everywhere.
 */
export function Face({
	name,
	seed,
	imageUrl,
	diameter,
}: {
	name: string;
	seed: string;
	imageUrl?: string | null;
	diameter: number;
}) {
	const { color, type } = useTheme();
	const palette = [
		color.avatar1,
		color.avatar2,
		color.avatar3,
		color.avatar4,
		color.avatar5,
		color.avatar6,
		color.avatar7,
		color.avatar8,
	];
	const background = palette[hash(seed) % palette.length];
	const image = imageUrl?.startsWith("http") ? imageUrl : null;
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				width: diameter,
				height: diameter,
				borderRadius: diameter / 2,
				overflow: "hidden",
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: background,
			}}
		>
			{image ? (
				<Image
					source={{ uri: image }}
					style={{ width: diameter, height: diameter }}
				/>
			) : (
				<Text
					style={{
						color: color.avatarFg,
						fontSize: type.meta.size,
						fontWeight: "600",
					}}
				>
					{initials(name)}
				</Text>
			)}
		</View>
	);
}

export function initials(name: string): string {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => Array.from(part)[0] ?? "")
		.join("")
		.toUpperCase();
}

function hash(text: string): number {
	let h = 0;
	for (const char of text) h = (h * 31 + char.charCodeAt(0)) >>> 0;
	return h;
}
