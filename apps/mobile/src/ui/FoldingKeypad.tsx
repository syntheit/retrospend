import { decimalSeparator } from "@retrospend/domain/parse";
import { useEffect, useRef } from "react";
import {
	Platform,
	Pressable,
	TextInput,
	type TextInputInstance,
	View,
} from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { useTranslations } from "use-intl";
import { useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import { applyEntryKey, BACKSPACE, type EntryKind } from "./keypad";
import { Text } from "./Text";

/** What the keypad types now: the text, how it reads, and where it goes. */
export interface KeypadEntry {
	text: string;
	/** The currency of a money entry; ignored for a percent or shares. */
	currency: string;
	kind: EntryKind;
	onChange: (text: string) => void;
}

/** The most a key label scales, so a row of keys keeps its height. */
const KEY_LABEL_SCALE = 1.3;
/** The sign each operator key adds on a long press. */
const HOLD = { "+": "×", "−": "÷" } as const;

/**
 * The money keypad and, folded, the one Add button, in the same place. Open,
 * it is a four by four grid: the digits and the decimal key, Delete, + and −
 * (hold them for × and ÷), and a wide Add key at the bottom right. Folded, the
 * keys give their height back to the panel above and one full-width primary
 * button stays ("Add expense", "Save" when editing). The caller decides when
 * it folds. The pad never grows with the text size: key labels stop at 1.3.
 * A part that is not money (a percent, shares) has no operators.
 *
 * On an iPad with a hardware keyboard the digits, Return and Tab work too,
 * through an invisible field that holds the keyboard focus.
 */
export function FoldingKeypad({
	open,
	entry,
	onAdd,
	addLabel,
	addDescription,
	foldedLabel,
	addOff,
	busy,
	compact = false,
	onOpen,
	onTab,
}: {
	open: boolean;
	entry: KeypadEntry;
	onAdd: () => void;
	/** The word on the Add key: "Add", or "Save" when editing. */
	addLabel: string;
	/** What a screen reader says for Add: "Add expense". */
	addDescription: string;
	/** The word on the folded button: "Add expense", or "Save" when editing. */
	foldedLabel: string;
	/** Nothing to add yet, or the dry run is not in. */
	addOff: boolean;
	busy: boolean;
	/** A short phone: 44 point keys and tighter gaps. */
	compact?: boolean;
	/** A hardware key was typed while folded: bring the keys back. */
	onOpen?: () => void;
	/** Tab on a hardware keyboard: the next panel. */
	onTab?: () => void;
}) {
	const t = useTranslations("mobile.keypad");
	const locale = useMoneyLocale();
	const { color, duration, radius, space } = useTheme();
	const separator = decimalSeparator(locale);
	const money = entry.kind === "money";
	// 48 point keys, 44 on a short phone.
	const keyHeight = compact ? space[12] - space[1] : space[12];
	const gap = compact ? space[1] : space[2];
	const enter = FadeIn.duration(duration.tab).reduceMotion(ReduceMotion.Never);
	const off = addOff || busy;

	function press(key: string) {
		entry.onChange(
			applyEntryKey(entry.text, key, entry.kind, locale, entry.currency),
		);
	}

	const Add = (
		<Pressable
			accessibilityLabel={addDescription}
			accessibilityRole="button"
			accessibilityState={{ disabled: off }}
			disabled={off}
			onPress={onAdd}
			style={({ pressed }) => ({
				minHeight: keyHeight,
				flexGrow: 1,
				alignItems: "center",
				justifyContent: "center",
				borderRadius: radius.ctl,
				backgroundColor: off
					? color.raised
					: pressed
						? color.brandHover
						: color.brand,
			})}
		>
			<Text
				maxFontSizeMultiplier={KEY_LABEL_SCALE}
				style={{ color: off ? color.fg3 : color.brandFg }}
				variant="section"
			>
				{open ? addLabel : foldedLabel}
			</Text>
		</Pressable>
	);

	const keys = useRef<TextInputInstance | null>(null);
	const hardware = Platform.OS === "ios" && Platform.isPad;
	useEffect(() => {
		if (hardware) keys.current?.focus();
	}, [hardware]);

	const catcher = hardware ? (
		<TextInput
			accessibilityElementsHidden
			autoCorrect={false}
			caretHidden
			importantForAccessibility="no-hide-descendants"
			onKeyPress={(event) => {
				const key = event.nativeEvent.key;
				if (key === "Enter") {
					if (!off) onAdd();
				} else if (key === "Tab") {
					onTab?.();
				} else if (key === "Backspace") {
					if (open) press(BACKSPACE);
				} else if (/^\d$/.test(key) || key === separator) {
					if (!open) onOpen?.();
					if (open || onOpen) press(key);
				}
			}}
			ref={keys}
			showSoftInputOnFocus={false}
			style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
			value=""
		/>
	) : null;

	if (!open) {
		return (
			<View>
				{catcher}
				<View style={{ flexDirection: "row" }}>{Add}</View>
			</View>
		);
	}

	const sign = (key: "+" | "−") => {
		const pressable = money;
		const held = HOLD[key];
		const name = key === "+" ? "plus" : "minus";
		return (
			<Pressable
				accessibilityActions={
					pressable ? [{ name: "hold", label: t(`${name}Hold`) }] : undefined
				}
				accessibilityLabel={pressable ? t(`${name}Spoken`) : undefined}
				accessibilityRole="button"
				accessibilityState={{ disabled: !pressable }}
				disabled={!pressable}
				key={key}
				onAccessibilityAction={() => press(held)}
				onLongPress={() => press(held)}
				onPress={() => press(key)}
				style={({ pressed }) => ({
					flex: 1,
					minHeight: keyHeight,
					alignItems: "center",
					justifyContent: "center",
					borderRadius: radius.ctl,
					backgroundColor: pressed ? color.line : color.raised,
					opacity: pressable ? 1 : 0,
				})}
			>
				<Text maxFontSizeMultiplier={KEY_LABEL_SCALE} variant="title">
					{key}
				</Text>
			</Pressable>
		);
	};

	const digit = (key: string) => {
		const flat = key === separator || key === BACKSPACE;
		const label =
			key === BACKSPACE ? t("delete") : key === separator ? t("decimal") : key;
		// A shares entry takes no decimal point: its key is blank, not hidden, so the grid holds.
		const blank = key === separator && entry.kind === "units";
		return (
			<Pressable
				accessibilityLabel={blank ? undefined : label}
				accessibilityRole="button"
				accessibilityState={{ disabled: blank }}
				disabled={blank}
				key={key}
				onPress={() => press(key)}
				style={({ pressed }) => ({
					flex: 1,
					minHeight: keyHeight,
					alignItems: "center",
					justifyContent: "center",
					borderRadius: radius.ctl,
					backgroundColor: pressed
						? color.line
						: flat
							? "transparent"
							: color.surface,
					opacity: blank ? 0 : 1,
				})}
			>
				<Text
					maxFontSizeMultiplier={KEY_LABEL_SCALE}
					tabular
					variant="title"
					weight="medium"
				>
					{key}
				</Text>
			</Pressable>
		);
	};

	return (
		<Animated.View entering={enter} style={{ gap, paddingTop: gap }}>
			{catcher}
			<View style={{ flexDirection: "row", gap }}>
				{digit("7")}
				{digit("8")}
				{digit("9")}
				{digit(BACKSPACE)}
			</View>
			<View style={{ flexDirection: "row", gap }}>
				{digit("4")}
				{digit("5")}
				{digit("6")}
				{sign("+")}
			</View>
			<View style={{ flexDirection: "row", gap }}>
				{digit("1")}
				{digit("2")}
				{digit("3")}
				{sign("−")}
			</View>
			<View style={{ flexDirection: "row", gap }}>
				{digit(separator)}
				{digit("0")}
				<View style={{ flex: 2, flexDirection: "row" }}>{Add}</View>
			</View>
		</Animated.View>
	);
}
