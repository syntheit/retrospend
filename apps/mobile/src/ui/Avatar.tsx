import { useState } from "react";
import { Image, Text, View } from "react-native";
import { useTheme } from "@/theme";

export interface Face {
	/** The person key (`user:ID`), which also picks the avatar color. */
	key: string;
	name: string;
	/** An absolute image address, when the person has a picture. */
	imageUri?: string | null;
}

type AvatarSize = "xs" | "sm" | "default" | "md" | "lg";

/** The same person always gets the same one of the eight avatar colors. */
export function avatarSlot(key: string): number {
	let sum = 0;
	for (const char of key) sum += char.codePointAt(0) ?? 0;
	return (sum % 8) + 1;
}

export function initialsOf(name: string): string {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => Array.from(part)[0] ?? "")
		.join("")
		.toUpperCase();
}

/**
 * A face: the picture, or the initials on one of the avatar colors. It is
 * decoration next to a name, so it hides from screen readers; the name
 * beside it is what they read.
 */
export function Avatar({
	face,
	size = "default",
}: {
	face: Face;
	size?: AvatarSize;
}) {
	const { color, size: sizes, type } = useTheme();
	const [failed, setFailed] = useState(false);
	const diameter = sizes.avatar[size];
	const palette = color as unknown as Record<string, string>;
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				width: diameter,
				height: diameter,
				borderRadius: diameter / 2,
				overflow: "hidden",
				backgroundColor: palette[`avatar${avatarSlot(face.key)}`],
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			{face.imageUri && !failed ? (
				<Image
					onError={() => setFailed(true)}
					source={{ uri: face.imageUri }}
					style={{ width: diameter, height: diameter }}
				/>
			) : (
				<Text
					style={{
						color: color.avatarFg,
						fontSize:
							diameter >= sizes.avatar.md ? type.body.size : type.meta.size,
						fontWeight: "600",
					}}
				>
					{initialsOf(face.name)}
				</Text>
			)}
		</View>
	);
}

/** A set of people as overlapping faces, the first few and a count for the rest. */
export function AvatarStack({
	faces,
	size = "sm",
	max = 3,
}: {
	faces: Face[];
	size?: AvatarSize;
	max?: number;
}) {
	const { color, size: sizes, space, type } = useTheme();
	const shown = faces.slice(0, max);
	const rest = faces.length - shown.length;
	const diameter = sizes.avatar[size];
	return (
		<View style={{ flexDirection: "row", alignItems: "center" }}>
			{shown.map((face, index) => (
				<View
					key={face.key}
					style={{
						marginLeft: index === 0 ? 0 : -space[2],
						borderRadius: diameter,
						borderWidth: 2,
						borderColor: color.bg,
					}}
				>
					<Avatar face={face} size={size} />
				</View>
			))}
			{rest > 0 ? (
				<Text
					style={{
						marginLeft: space[1],
						color: color.fg2,
						fontSize: type.meta.size,
					}}
				>
					{`+${rest}`}
				</Text>
			) : null}
		</View>
	);
}
