"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { CurrencyBackground } from "~/components/currency-background";
import { Chip } from "~/components/ui/chip";
import { Label } from "~/components/ui/label";
import { Segmented } from "~/components/ui/segmented";
import { Sheet } from "~/components/ui/sheet";
import {
	type BackgroundSettings,
	defaultBackgroundSettings,
} from "~/lib/background-settings";
import { api } from "~/trpc/react";
import { useAutosave } from "../autosave";
import { SelectField } from "../select-field";

type SymbolSet = BackgroundSettings["symbolSets"][number];
const SYMBOLS: SymbolSet[] = ["currency", "math", "finance"];
const COLORS: BackgroundSettings["color"][] = [
	"gray",
	"green",
	"blue",
	"purple",
	"orange",
	"gold",
];

const same = (a: BackgroundSettings, b: BackgroundSettings) =>
	JSON.stringify(a) === JSON.stringify(b);

/**
 * The public profile background (today's Profile background card) in a
 * sheet: a live preview, then symbols, color, density, motion and opacity.
 * Each change saves with Undo.
 */
export function BackgroundSheet({
	open,
	onOpenChange,
	seed,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The username: the preview lays symbols out as the profile page does. */
	seed: string;
}) {
	const t = useTranslations("settingsV2.background");
	const save = useAutosave();
	const utils = api.useUtils();
	const { data: saved } = api.profile.getBackgroundSettings.useQuery(
		undefined,
		{
			enabled: open,
		},
	);
	const mutation = api.profile.saveBackgroundSettings.useMutation();
	const [settings, setSettings] = useState(defaultBackgroundSettings);
	const loaded = useRef(false);

	useEffect(() => {
		if (saved && !loaded.current) {
			loaded.current = true;
			setSettings(saved);
		}
	}, [saved]);

	const apply = async (next: BackgroundSettings) => {
		setSettings(next);
		await mutation.mutateAsync(next);
		await utils.profile.getBackgroundSettings.invalidate();
	};
	const change = (patch: Partial<BackgroundSettings>) =>
		void save({ apply, next: { ...settings, ...patch }, prev: settings }, same);
	const toggleSet = (set: SymbolSet) => {
		const has = settings.symbolSets.includes(set);
		// At least one set stays on (the server requires one).
		if (has && settings.symbolSets.length === 1) return;
		change({
			symbolSets: has
				? settings.symbolSets.filter((s) => s !== set)
				: [...settings.symbolSets, set],
		});
	};

	return (
		<Sheet
			detent="large"
			footer={false}
			onOpenChange={onOpenChange}
			open={open}
			title={t("title")}
		>
			<div className="flex flex-col gap-4">
				<div className="relative h-36 overflow-hidden rounded-ctl bg-raised">
					<CurrencyBackground
						animation={settings.animation}
						color={settings.color}
						density={settings.density}
						opacity={settings.opacity}
						seed={seed}
						symbolSets={settings.symbolSets}
					/>
				</div>
				<div className="flex flex-col gap-2">
					<span className="font-medium text-fg-2 text-small">
						{t("symbols")}
					</span>
					<div className="flex flex-wrap gap-2">
						{SYMBOLS.map((s) => (
							<Chip
								active={settings.symbolSets.includes(s)}
								aria-pressed={settings.symbolSets.includes(s)}
								key={s}
								onClick={() => toggleSet(s)}
							>
								{t(`symbol.${s}`)}
							</Chip>
						))}
					</div>
				</div>
				<div className="flex items-center justify-between gap-3">
					<Label className="text-fg-2" htmlFor="bg-color">
						{t("color")}
					</Label>
					<SelectField
						id="bg-color"
						onChange={(color) => change({ color })}
						options={COLORS.map((c) => ({ value: c, label: t(`colors.${c}`) }))}
						value={settings.color}
					/>
				</div>
				<Choice label={t("density")}>
					<Segmented
						full
						label={t("density")}
						onChange={(density) => change({ density })}
						options={(["sparse", "medium", "dense"] as const).map((v) => ({
							value: v,
							label: t(`densities.${v}`),
						}))}
						value={settings.density}
					/>
				</Choice>
				<Choice label={t("motion")}>
					<Segmented
						full
						label={t("motion")}
						onChange={(animation) => change({ animation })}
						options={(["static", "float", "pulse"] as const).map((v) => ({
							value: v,
							label: t(`motions.${v}`),
						}))}
						value={settings.animation}
					/>
				</Choice>
				<Choice label={t("opacity")}>
					<Segmented
						full
						label={t("opacity")}
						onChange={(opacity) => change({ opacity })}
						options={(["subtle", "medium", "bold"] as const).map((v) => ({
							value: v,
							label: t(`opacities.${v}`),
						}))}
						value={settings.opacity}
					/>
				</Choice>
			</div>
		</Sheet>
	);
}

function Choice({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2">
			<span className="font-medium text-fg-2 text-small">{label}</span>
			{children}
		</div>
	);
}
