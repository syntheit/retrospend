import { useEffect, useState } from "react";
import { Image, Text, type TextStyle, View } from "react-native";
import { type Theme, useTheme } from "@/theme";
import { Glyph } from "./Glyph";

/** A weight token (400, 500, 600) as the style value React Native takes. */
const weightStyle = (value: number) => String(value) as TextStyle["fontWeight"];

export interface Face {
	/** The person key (`user:ID`), which also picks the avatar color. */
	key: string;
	name: string;
	/** An absolute image address, when the person has a picture. */
	imageUri?: string | null;
}

/** xs 22, sm 24, default 32, md 40, row 44, lg 48, xl 64, xxl 80. */
export type AvatarSize = keyof Theme["size"]["avatar"];

/** The same person always gets the same one of the eight avatar colors. */
export function avatarSlot(key: string): number {
	let sum = 0;
	for (const char of key) sum += char.codePointAt(0) ?? 0;
	return (sum % 8) + 1;
}

/** The avatar color token for a person or project key (see avatarSlot). */
export function avatarColor(color: Theme["color"], key: string): string {
	return color[`avatar${avatarSlot(key)}` as keyof Theme["color"]] ?? color.fg3;
}

/**
 * Initials as the web draws them: the first letters of the first and last
 * words, or the first two letters of a one-word name. `one` keeps only the
 * first letter, for faces too small to fit two.
 */
export function initialsOf(name: string, one = false): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	const first = Array.from(words[0] ?? "");
	if (one) return (first[0] ?? "").toLocaleUpperCase();
	const last = words.length > 1 ? words[words.length - 1] : undefined;
	const pick = last
		? (first[0] ?? "") + (Array.from(last)[0] ?? "")
		: first.slice(0, 2).join("");
	return pick.toLocaleUpperCase();
}

/** The initials' size for a face: meta up to 32, small to 44, body at 48, title above. */
function initialsSize(diameter: number, theme: Theme): number {
	const { size, type } = theme;
	if (diameter <= size.avatar.default) return type.meta.size;
	if (diameter <= size.avatar.row) return type.small.size;
	if (diameter <= size.avatar.lg) return type.body.size;
	return type.title.size;
}

/**
 * A face: the picture, or the initials on one of the avatar colors. At 24
 * or below it shows one initial, so two letters never collide. It is
 * decoration next to a name, so it hides from screen readers; the name
 * beside it is what they read.
 *
 * `offApp` is a person who is not on Retrospend: a dashed ring around the
 * face, drawn outside its box so the layout does not move. `checked` is a
 * picked face in a picker: a small brand tick at the lower end, also outside
 * the box. Neither carries meaning alone; the row says it in words.
 */
export function Avatar({
	face,
	size = "default",
	offApp,
	checked,
}: {
	face: Face;
	size?: AvatarSize;
	offApp?: boolean;
	checked?: boolean;
}) {
	const theme = useTheme();
	const { color, font, size: sizes, space } = theme;
	const [failed, setFailed] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new address resets
	useEffect(() => setFailed(false), [face.imageUri]);
	const diameter = sizes.avatar[size];
	// The ring sits a hairline gap and its own width outside the face.
	const gap = space[1] / 2;
	const ringWidth = 1;
	const reach = gap + ringWidth;
	const tick = space[4];
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{ width: diameter, height: diameter }}
		>
			<View
				style={{
					width: diameter,
					height: diameter,
					borderRadius: diameter / 2,
					overflow: "hidden",
					backgroundColor: avatarColor(color, face.key),
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				{face.imageUri && !failed ? (
					<Image
						accessibilityIgnoresInvertColors
						onError={() => setFailed(true)}
						source={{ uri: face.imageUri }}
						style={{ width: diameter, height: diameter }}
					/>
				) : (
					<Text
						allowFontScaling={false}
						style={{
							color: color.avatarFg,
							fontSize: initialsSize(diameter, theme),
							fontWeight: weightStyle(font.weight.semibold),
						}}
					>
						{initialsOf(face.name, diameter <= sizes.avatar.sm)}
					</Text>
				)}
			</View>
			{offApp ? (
				<View
					pointerEvents="none"
					style={{
						position: "absolute",
						top: -reach,
						left: -reach,
						width: diameter + 2 * reach,
						height: diameter + 2 * reach,
						borderRadius: (diameter + 2 * reach) / 2,
						borderWidth: ringWidth,
						borderStyle: "dashed",
						borderColor: color.fg3,
					}}
				/>
			) : null}
			{checked ? (
				<View
					pointerEvents="none"
					style={{
						position: "absolute",
						right: -gap,
						bottom: -gap,
						width: tick,
						height: tick,
						borderRadius: tick / 2,
						backgroundColor: color.brand,
						borderWidth: gap,
						borderColor: color.surface,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<Glyph color={color.brandFg} name="Check" size={space[2]} />
				</View>
			) : null}
		</View>
	);
}

/** Who shows and how many fold into +N: `max` slots, the last one is +N. */
export function splitFaces(faces: Face[], max: number) {
	if (faces.length <= max) return { shown: faces, rest: 0 };
	const shown = faces.slice(0, Math.max(1, max - 1));
	return { shown, rest: faces.length - shown.length };
}

/** The payer first, everyone else in the order given. */
export function orderFaces(faces: Face[], payerKey?: string): Face[] {
	if (!payerKey) return faces;
	return [
		...faces.filter((face) => face.key === payerKey),
		...faces.filter((face) => face.key !== payerKey),
	];
}

/**
 * A set of people as overlapping faces (R20, GUIDELINE §8): each face ringed
 * in the fill behind the stack (`ring`, the page or a surface), the payer
 * first with an accent ring, and a round +N chip for the rest. The row it
 * sits in names the people, so the stack hides from screen readers.
 */
export function AvatarStack({
	faces,
	size = "sm",
	max = 4,
	ring = "bg",
	payerKey,
}: {
	faces: Face[];
	size?: AvatarSize;
	/** Slots, counting the +N chip. */
	max?: number;
	/** The fill behind the stack: the page, or a surface (a group row, a sheet). */
	ring?: "bg" | "surface";
	/** The person who paid: first, with an accent ring. */
	payerKey?: string;
}) {
	const theme = useTheme();
	const { color, font, radius, size: sizes, space } = theme;
	const { shown, rest } = splitFaces(orderFaces(faces, payerKey), max);
	if (shown.length === 0) return null;
	const diameter = sizes.avatar[size];
	const overlap = diameter >= sizes.avatar.md ? space[2] : space[1];
	const ringColor = ring === "surface" ? color.surface : color.bg;
	// The separating ring; the payer's accent ring sits outside it.
	const edge = space[1] / 2;
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{ flexDirection: "row", alignItems: "center" }}
		>
			{shown.map((face, index) => {
				const paid = face.key === payerKey && shown.length > 1;
				return (
					<View
						key={face.key}
						style={{
							marginLeft: index === 0 ? 0 : -overlap,
							borderRadius: radius.chip,
							borderWidth: paid ? edge : 0,
							borderColor: color.accent,
						}}
					>
						<View
							style={{
								borderRadius: radius.chip,
								borderWidth: edge,
								borderColor: ringColor,
							}}
						>
							<Avatar face={face} size={size} />
						</View>
					</View>
				);
			})}
			{rest > 0 ? (
				<View
					style={{
						marginLeft: -overlap,
						borderRadius: radius.chip,
						borderWidth: edge,
						borderColor: ringColor,
					}}
				>
					<View
						style={{
							height: diameter,
							minWidth: diameter,
							paddingHorizontal: space[1],
							borderRadius: radius.chip,
							backgroundColor: color.raised,
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						<Text
							allowFontScaling={false}
							style={{
								color: color.fg2,
								fontSize: initialsSize(diameter, theme),
								fontVariant: ["tabular-nums"],
								fontWeight: weightStyle(font.weight.medium),
							}}
						>
							{`+${rest}`}
						</Text>
					</View>
				</View>
			) : null}
		</View>
	);
}
