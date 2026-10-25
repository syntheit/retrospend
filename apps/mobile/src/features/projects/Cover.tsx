import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { useTheme } from "@/theme";
import { avatarSlot } from "@/ui/Avatar";

/**
 * A project's cover: the picture when it has one, else its first letter on
 * one of the avatar colors. Content, not decoration, so it is a rounded
 * square (faces are circles), and it hides from screen readers: the name
 * beside it is what they read.
 */
export function Cover({
	id,
	name,
	imageUri,
	diameter,
}: {
	id: string;
	name: string;
	imageUri: string | null;
	diameter: number;
}) {
	const { color, radius, type } = useTheme();
	const [failed, setFailed] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new address resets
	useEffect(() => setFailed(false), [imageUri]);
	const palette = color as unknown as Record<string, string>;
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				width: diameter,
				height: diameter,
				borderRadius: radius.ctl,
				overflow: "hidden",
				backgroundColor: palette[`avatar${avatarSlot(`project:${id}`)}`],
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			{imageUri && !failed ? (
				<Image
					onError={() => setFailed(true)}
					source={{ uri: imageUri }}
					style={{ width: diameter, height: diameter }}
				/>
			) : (
				<Text
					style={{
						color: color.avatarFg,
						fontSize: type.section.size,
						fontWeight: "600",
					}}
				>
					{Array.from(name.trim())[0]?.toUpperCase() ?? ""}
				</Text>
			)}
		</View>
	);
}
