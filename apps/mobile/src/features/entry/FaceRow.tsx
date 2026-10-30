import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";

import { useTheme } from "@/theme";
import { Avatar, type Face } from "@/ui/Avatar";
import { PickerSheet } from "@/ui/PickerSheet";
import { Text } from "@/ui/Text";
import { usePersonFaces } from "./Face";
import { type EntryPerson, personKey } from "./types";

/** How many people show as columns before the rest wait behind Add. */
const SHOWN = 8;

/** A face with the brand tick while the person is on the expense. */
function FaceRing({ face, on }: { face: Face; on: boolean }) {
	const { space } = useTheme();
	// The tick sits outside the face, so the padding keeps the column's width.
	return (
		<View style={{ padding: space[1] }}>
			<Avatar checked={on} face={face} size="sm" />
		</View>
	);
}

/**
 * Who it is split with: faces in columns, you first and Add last. A face
 * carries the brand tick and a heavier name when the person is on the expense
 * (state is never color alone). Add opens a search over everyone you can
 * split with, for the people past the columns.
 */
export function FaceRow({
	people,
	selected,
	onToggle,
}: {
	/** Everyone the split can name, the latest shared first. */
	people: EntryPerson[];
	/** Person keys on the expense. */
	selected: string[];
	onToggle: (key: string) => void;
}) {
	const t = useTranslations("mobile.composer");
	const tp = useTranslations("mobile.pickers");
	const { state } = useSession();
	const faces = usePersonFaces();
	const { color, radius, size, space } = useTheme();
	const [searching, setSearching] = useState(false);
	const me = state.status === "signedIn" ? state.me : null;
	const [meFace] = faces([
		{
			key: `user:${me?.id ?? "me"}`,
			name: me?.name ?? t("you"),
			imageUrl: me?.avatarUrl ?? null,
		},
	]);
	// The columns: the latest people, plus anyone picked from the search.
	const shown = [
		...people.slice(0, SHOWN),
		...people.slice(SHOWN).filter((p) => selected.includes(personKey(p))),
	];
	const column = size.touchMin.phone + space[2];
	const ring = space[1] / 2;

	return (
		<>
			<ScrollView
				accessibilityLabel={t("with")}
				contentContainerStyle={{ gap: space[2] }}
				horizontal
				keyboardShouldPersistTaps="handled"
				showsHorizontalScrollIndicator={false}
			>
				{/* You are always on the expense: shown first, lit, nothing to toggle. */}
				<View
					accessibilityLabel={t("you")}
					accessibilityState={{ selected: true }}
					accessible
					style={{ width: column, alignItems: "center", gap: space[1] }}
				>
					{meFace ? <FaceRing face={meFace} on /> : null}
					<Text numberOfLines={1} variant="meta" weight="semibold">
						{t("you")}
					</Text>
				</View>
				{shown.map((person) => {
					const key = personKey(person);
					const on = selected.includes(key);
					const [face] = faces([{ key, ...person }]);
					return (
						<Pressable
							accessibilityLabel={person.name}
							accessibilityRole="button"
							accessibilityState={{ selected: on }}
							hitSlop={space[1]}
							key={key}
							onPress={() => onToggle(key)}
							style={{
								width: column,
								minHeight: size.touchMin.phone,
								alignItems: "center",
								gap: space[1],
							}}
						>
							{face ? <FaceRing face={face} on={on} /> : null}
							<Text
								numberOfLines={1}
								tone={on ? "fg" : "fg2"}
								variant="meta"
								weight={on ? "semibold" : "normal"}
							>
								{person.name.split(/\s+/)[0] ?? person.name}
							</Text>
						</Pressable>
					);
				})}
				<Pressable
					accessibilityLabel={t("faces.addLabel")}
					accessibilityRole="button"
					hitSlop={space[1]}
					onPress={() => setSearching(true)}
					style={{
						width: column,
						minHeight: size.touchMin.phone,
						alignItems: "center",
						gap: space[1],
					}}
				>
					<View style={{ padding: ring + ring }}>
						<View
							style={{
								width: size.avatar.sm,
								height: size.avatar.sm,
								borderRadius: radius.chip,
								alignItems: "center",
								justifyContent: "center",
								backgroundColor: color.raised,
							}}
						>
							<Text tone="fg2" variant="title">
								+
							</Text>
						</View>
					</View>
					<Text numberOfLines={1} tone="fg2" variant="meta">
						{t("faces.add")}
					</Text>
				</Pressable>
			</ScrollView>
			<PickerSheet
				clear={tp("clear")}
				empty={t("faces.empty")}
				find={t("faces.find")}
				groups={[
					{
						key: "people",
						heading: t("faces.title"),
						rows: people.map((person) => {
							const key = personKey(person);
							const [face] = faces([{ key, ...person }]);
							return {
								id: key,
								label: person.name,
								lead: face ? <Avatar face={face} size="sm" /> : null,
								selected: selected.includes(key),
							};
						}),
					},
				]}
				onClose={() => setSearching(false)}
				onSelect={onToggle}
				title={t("faces.title")}
				visible={searching}
			/>
		</>
	);
}
