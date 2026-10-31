import { type ReactNode, useState } from "react";
import { Pressable, View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { Glyph, type GlyphName } from "@/ui/Glyph";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { ChangesBlock } from "./ChangesBlock";
import {
	isPersonal,
	LOCATION_LIMIT,
	NOTE_LIMIT,
	SHARED_NOTE_LIMIT,
	SPREAD_MONTHS,
} from "./draft";
import type { ComposerPreview } from "./useComposerPreview";
import type { EntryForm } from "./useEntryForm";

/** The months the server takes for a spread. */
const SPREAD_MIN = 2;
const SPREAD_MAX = 24;
/** The usual choices; a saved odd one is offered too. */
const USUAL = SPREAD_MONTHS.filter((m) => m <= 12);

/** The word at the end of a row that says what a tap does, or what is on. */
function RowState({ label, on }: { label: string; on: boolean }) {
	const { color, radius, space } = useTheme();
	return (
		<View
			style={{
				paddingHorizontal: space[3],
				paddingVertical: space[1],
				borderRadius: radius.chip,
				backgroundColor: on ? color.brand : color.brandSoft,
			}}
		>
			<Text
				scale="chrome"
				style={{ color: on ? color.brandFg : color.brand }}
				variant="small"
				weight="medium"
			>
				{label}
			</Text>
		</View>
	);
}

/**
 * One option of More: a quiet stroke icon, its name, and a pill that says
 * what a tap does (Add or Remove; On or Off for a switch). Turning it on
 * opens its control under the row, in place.
 */
function OptionRow({
	icon,
	name,
	state,
	on,
	filled,
	onPress,
	children,
}: {
	icon: GlyphName;
	name: string;
	/** The pill's word: Add, Remove, On, Off. */
	state: string;
	/** The option is on (a filled pill for a switch). */
	on: boolean;
	filled?: boolean;
	onPress: () => void;
	children?: ReactNode;
}) {
	const { color, radius, size, space } = useTheme();
	return (
		<View
			style={{
				borderRadius: radius.panel,
				backgroundColor: color.surface,
				overflow: "hidden",
			}}
		>
			<Pressable
				accessibilityLabel={`${name}, ${state}`}
				accessibilityRole="button"
				accessibilityState={{ selected: on }}
				onPress={onPress}
				style={({ pressed }) => ({
					minHeight: size.touchMin.phone,
					flexDirection: "row",
					alignItems: "center",
					gap: space[3],
					paddingHorizontal: space[3],
					backgroundColor: pressed ? color.raised : "transparent",
				})}
			>
				<Glyph color={color.fg3} name={icon} size={size.icon.phone} />
				<Text numberOfLines={1} style={{ flex: 1 }}>
					{name}
				</Text>
				<RowState label={state} on={filled === true && on} />
			</Pressable>
			{children ? (
				<View
					style={{
						gap: space[2],
						paddingHorizontal: space[3],
						paddingBottom: space[3],
						paddingLeft: space[3] + size.icon.phone + space[3],
					}}
				>
					{children}
				</View>
			) : null}
		</View>
	);
}

/**
 * More, in place: Note, Spread over months, Exclude from spending and
 * Location, each a row with a quiet icon and an Add/Remove (or On/Off) pill,
 * and What this changes, the full list the one-line preview summarizes. A
 * split keeps only its note, as the server does. Nothing here is on until the
 * person turns it on, so a new expense is the same as it was without More.
 */
export function MorePanel({
	form,
	preview,
	onPicked,
}: {
	form: EntryForm;
	preview: ComposerPreview;
	/** An option was turned on or off or a choice made: the keys may fold. */
	onPicked: () => void;
}) {
	const t = useTranslations("mobile.composer");
	const { space } = useTheme();
	const draft = form.expense;
	const personal = isPersonal(draft);
	const set = form.patchExpense;
	const [noteOpen, setNoteOpen] = useState(draft.note.length > 0);
	const [placeOpen, setPlaceOpen] = useState(draft.location.length > 0);
	const [customOpen, setCustomOpen] = useState(false);
	const [customText, setCustomText] = useState("");
	const [changesOpen, setChangesOpen] = useState(false);
	const add = t("extras.add");
	const remove = t("extras.remove");
	// A saved odd spread (say 4 months) stays offered next to the usual ones.
	const months = [
		...new Set([...USUAL, ...(draft.spread ? [draft.spread] : [])]),
	].sort((a, b) => a - b);

	function customMonths(text: string) {
		const digits = text.replace(/\D/g, "").slice(0, 2);
		setCustomText(digits);
		const count = Number(digits);
		if (count >= SPREAD_MIN && count <= SPREAD_MAX) set({ spread: count });
	}

	return (
		<View style={{ gap: space[2] }}>
			<OptionRow
				icon="Pencil"
				name={t("note")}
				on={noteOpen}
				onPress={() => {
					if (noteOpen) set({ note: "" });
					setNoteOpen(!noteOpen);
					onPicked();
				}}
				state={noteOpen ? remove : add}
			>
				{noteOpen ? (
					<TextField
						autoCapitalize="sentences"
						hideLabel
						label={t("note")}
						maxLength={personal ? NOTE_LIMIT : SHARED_NOTE_LIMIT}
						onChangeText={(note) => set({ note })}
						onTypingChange={form.setTyping}
						placeholder={t("notePlaceholder")}
						value={draft.note}
					/>
				) : null}
			</OptionRow>
			{personal ? (
				<>
					<OptionRow
						icon="CalendarRange"
						name={t("extras.spread")}
						on={draft.spread !== null}
						onPress={() => {
							if (draft.spread !== null) {
								set({ spread: null });
								setCustomOpen(false);
							} else {
								set({ spread: 3 });
							}
							onPicked();
						}}
						state={draft.spread !== null ? remove : add}
					>
						{draft.spread !== null ? (
							<>
								<View
									accessibilityLabel={t("spread")}
									accessibilityRole="radiogroup"
									style={{
										flexDirection: "row",
										flexWrap: "wrap",
										gap: space[2],
									}}
								>
									{months.map((count) => (
										<Chip
											key={count}
											label={t("spreadMonths", { count })}
											onPress={() => {
												set({ spread: count });
												setCustomOpen(false);
												onPicked();
											}}
											selected={draft.spread === count && !customOpen}
										/>
									))}
									<Chip
										label={t("extras.custom")}
										onPress={() => setCustomOpen(true)}
										selected={customOpen}
									/>
								</View>
								{customOpen ? (
									<TextField
										keyboardType="number-pad"
										label={t("extras.months", {
											min: SPREAD_MIN,
											max: SPREAD_MAX,
										})}
										onChangeText={customMonths}
										onTypingChange={form.setTyping}
										placeholder={t("extras.monthsPlaceholder")}
										value={customText}
									/>
								) : null}
							</>
						) : null}
					</OptionRow>
					<OptionRow
						filled
						icon="EyeOff"
						name={t("exclude")}
						on={draft.exclude}
						onPress={() => {
							set({
								exclude: !draft.exclude,
								excludeTouched: true,
								excludeAuto: false,
							});
							onPicked();
						}}
						state={draft.exclude ? t("extras.on") : t("extras.off")}
					>
						{draft.exclude ? (
							<Text tone="fg2" variant="small">
								{draft.excludeAuto ? t("excludeAuto") : t("excludeDetail")}
							</Text>
						) : null}
					</OptionRow>
					<OptionRow
						icon="MapPin"
						name={t("location")}
						on={placeOpen}
						onPress={() => {
							if (placeOpen) set({ location: "" });
							setPlaceOpen(!placeOpen);
							onPicked();
						}}
						state={placeOpen ? remove : add}
					>
						{placeOpen ? (
							<TextField
								autoCapitalize="sentences"
								hideLabel
								label={t("location")}
								maxLength={LOCATION_LIMIT}
								onChangeText={(location) => set({ location })}
								onTypingChange={form.setTyping}
								placeholder={t("locationPlaceholder")}
								value={draft.location}
							/>
						) : null}
					</OptionRow>
				</>
			) : null}
			<OptionRow
				icon="ListChecks"
				name={t("extras.changes")}
				on={changesOpen}
				onPress={() => setChangesOpen(!changesOpen)}
				state={changesOpen ? t("extras.hide") : t("extras.show")}
			>
				{changesOpen ? (
					<ChangesBlock
						idle={t("changes.emptyExpense")}
						onRetry={preview.retry}
						state={preview.preview}
					/>
				) : null}
			</OptionRow>
		</View>
	);
}
