import { categoryTone } from "@retrospend/domain/category-tone";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { categoryColor } from "@/ui/Glyph";
import { Segmented } from "@/ui/Segmented";
import { Sheet, useSheetBodySize } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { FieldLabel } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";
import { Choice } from "./categories/Choice";

type Background = {
	symbolSets: ("currency" | "math" | "finance")[];
	color: "gray" | "green" | "blue" | "purple" | "orange" | "gold";
	density: "sparse" | "medium" | "dense";
	animation: "static" | "float" | "pulse";
	opacity: "subtle" | "medium" | "bold";
};

const SETS = ["currency", "math", "finance"] as const;
const COLORS = ["gray", "green", "blue", "purple", "orange", "gold"] as const;
const DENSITIES = ["sparse", "medium", "dense"] as const;
const OPACITIES = ["subtle", "medium", "bold"] as const;

// The stored color names, drawn with the category slot nearest each hue.
const TONE_OF: Record<Background["color"], string> = {
	gray: "gray",
	green: "emerald",
	blue: "blue",
	purple: "purple",
	orange: "orange",
	gold: "yellow",
};

const SYMBOLS: Record<Background["symbolSets"][number], string[]> = {
	currency: ["$", "€", "£", "¥", "₿", "₽"],
	math: ["+", "−", "×", "÷", "=", "%"],
	finance: ["#", "@", "&", "¢", "‰"],
};

const SHOWN = { subtle: 0.3, medium: 0.6, bold: 1 } as const;
const COUNT = { sparse: 6, medium: 9, dense: 12 } as const;

/**
 * The public profile page's background: a preview, then symbols, color,
 * density and opacity. Every change saves at once and says so in a toast with
 * Undo (the web's sheet does the same). The motion setting stays as it is.
 */
export function BackgroundSheet({
	visible,
	onClose,
}: {
	visible: boolean;
	onClose: () => void;
}) {
	const t = useTranslations("mobile.settings.profile.backgroundSheet");
	const ts = useTranslations("mobile.settings");
	const tc = useTranslations("mobile.common");
	const { api } = useSession();
	const toast = useToast();
	const { color, radius, space } = useTheme();
	const body = useSheetBodySize();
	const [settings, setSettings] = useState<Background | null>(null);
	const [failed, setFailed] = useState(false);
	const current = useRef<Background | null>(null);
	current.current = settings;

	useEffect(() => {
		if (!visible || !api) return;
		let live = true;
		setFailed(false);
		api.profile
			.getBackground()
			.then((saved) => {
				if (live) setSettings(saved);
			})
			.catch(() => {
				if (live) setFailed(true);
			});
		return () => {
			live = false;
		};
	}, [visible, api]);

	async function write(next: Background) {
		if (!api) return false;
		try {
			await api.profile.setBackground(next, {
				context: { idempotencyKey: newClientId() },
			});
			return true;
		} catch {
			return false;
		}
	}

	async function change(patch: Partial<Background>) {
		const before = current.current;
		if (!before) return;
		const next = { ...before, ...patch };
		setSettings(next);
		if (await write(next)) {
			toast.show({
				message: ts("saved"),
				undo: {
					label: tc("undo"),
					onUndo: async () => {
						setSettings(before);
						if (await write(before)) return;
						// The server still has the new look: show it, and say so.
						setSettings(next);
						toast.show({ message: t("error") });
					},
				},
			});
			return;
		}
		setSettings(before);
		toast.show({ message: t("error") });
	}

	function toggle(set: Background["symbolSets"][number]) {
		if (!settings) return;
		const has = settings.symbolSets.includes(set);
		// At least one set stays on: the server requires one.
		if (has && settings.symbolSets.length === 1) return;
		void change({
			symbolSets: has
				? settings.symbolSets.filter((s) => s !== set)
				: [...settings.symbolSets, set],
		});
	}

	const preview = settings
		? settings.symbolSets
				.flatMap((set) => SYMBOLS[set])
				.slice(0, COUNT[settings.density])
				.join(" ")
		: "";

	return (
		<Sheet
			detents={["large"]}
			dismiss="done"
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			{settings ? (
				<ScrollView
					contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
					style={{ height: body.height }}
				>
					<View
						style={{
							height: space[8] + space[6],
							alignItems: "center",
							justifyContent: "center",
							overflow: "hidden",
							borderRadius: radius.ctl,
							backgroundColor: color.raised,
						}}
					>
						<Text
							numberOfLines={2}
							style={{
								color: categoryColor(
									color,
									categoryTone(TONE_OF[settings.color]),
								),
								opacity: SHOWN[settings.opacity],
								textAlign: "center",
							}}
							variant="section"
						>
							{preview}
						</Text>
					</View>
					<View style={{ gap: space[2] }}>
						<FieldLabel>{t("symbols")}</FieldLabel>
						<View
							style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}
						>
							{SETS.map((set) => (
								<Chip
									key={set}
									label={t(`symbol.${set}`)}
									onPress={() => toggle(set)}
									selected={settings.symbolSets.includes(set)}
								/>
							))}
						</View>
					</View>
					<View style={{ gap: space[2] }}>
						<FieldLabel>{t("color")}</FieldLabel>
						<View
							style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}
						>
							{COLORS.map((name) => (
								<Choice
									fill={categoryColor(color, categoryTone(TONE_OF[name]))}
									key={name}
									label={t(`colors.${name}`)}
									onPress={() => void change({ color: name })}
									selected={settings.color === name}
									shape="swatch"
								/>
							))}
						</View>
					</View>
					<View style={{ gap: space[2] }}>
						<FieldLabel>{t("density")}</FieldLabel>
						<Segmented
							accessibilityLabel={t("density")}
							onChange={(density) => void change({ density })}
							options={DENSITIES.map((value) => ({
								value,
								label: t(`densities.${value}`),
							}))}
							stretch
							value={settings.density}
						/>
					</View>
					<View style={{ gap: space[2] }}>
						<FieldLabel>{t("opacity")}</FieldLabel>
						<Segmented
							accessibilityLabel={t("opacity")}
							onChange={(opacity) => void change({ opacity })}
							options={OPACITIES.map((value) => ({
								value,
								label: t(`opacities.${value}`),
							}))}
							stretch
							value={settings.opacity}
						/>
					</View>
				</ScrollView>
			) : (
				<Text tone="fg3">{failed ? t("error") : t("loading")}</Text>
			)}
		</Sheet>
	);
}
