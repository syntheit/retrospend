"use client";

import { draftFromMinor } from "@retrospend/domain/parse";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { minorOf } from "~/components/money/money-cell";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";
import { useAmount } from "./use-amount";

export type SetupInput = RouterInputs["envelope"]["setup"];
export type SetupStyle = SetupInput["style"];
type Preset = RouterOutputs["envelope"]["setupPreset"];
type PresetEnvelope = Preset["envelopes"][number];
type Target = NonNullable<PresetEnvelope["target"]>;

/** The target kinds that carry an amount the person may change. */
export const hasAmount = (
	t: Target | null,
): t is Extract<Target, { kind: "MONTHLY" | "BILL" | "SAVINGS" }> =>
	t !== null &&
	(t.kind === "MONTHLY" || t.kind === "BILL" || t.kind === "SAVINGS");

/**
 * The setup sheet's state: the style, what you have now, and the style's
 * proposed envelopes (the server's preset) with the ones you keep and the
 * amounts you changed. `input` is the write exactly as typed; the server
 * previews and writes it. Names the preset gives as keys are translated here.
 */
export function useSetup(locale: string) {
	const t = useTranslations();
	const [style, setStyle] = useState<SetupStyle>("FLEX");
	// Once the budget exists the proposal is refused, so it is not read again.
	const [done, setDone] = useState(false);
	const preset = api.envelope.setupPreset.useQuery(
		{ style },
		{ enabled: !done, retry: false },
	);
	const [off, setOff] = useState<ReadonlySet<string>>(new Set());
	const [texts, setTexts] = useState<Record<string, string>>({});
	const p = preset.data ?? null;
	const money = useAmount(p?.currency ?? "");

	// A new style starts from its own proposal.
	useEffect(() => {
		if (!p) return;
		setOff(new Set());
		const next: Record<string, string> = {};
		for (const e of p.envelopes)
			if (hasAmount(e.target) && e.target.amountMinor)
				next[e.key] = draftFromMinor(e.target.amountMinor, locale, p.currency);
		setTexts(next);
	}, [p, locale]);

	const toggle = useCallback((key: string) => {
		setOff((s) => {
			const n = new Set(s);
			if (n.has(key)) n.delete(key);
			else n.add(key);
			return n;
		});
	}, []);
	const setText = useCallback(
		(key: string, text: string) => setTexts((s) => ({ ...s, [key]: text })),
		[],
	);

	const name = useCallback(
		(key: string | null, fallback: string | null) =>
			fallback ?? (key ? (t as unknown as (k: string) => string)(key) : ""),
		[t],
	);

	const input = useMemo<SetupInput | null>(() => {
		if (!p) return null;
		const keep = p.envelopes.filter((e) => e.isDefault || !off.has(e.key));
		const envelopes: SetupInput["envelopes"] = [];
		for (const e of keep) {
			let target: SetupInput["envelopes"][number]["target"];
			if (e.target && hasAmount(e.target)) {
				const minor = minorOf(texts[e.key] ?? "", locale, p.currency);
				if (minor === null && texts[e.key]) return null;
				target =
					e.target.kind === "SAVINGS"
						? { ...e.target, ...(minor ? { amountMinor: minor } : {}) }
						: minor
							? { ...e.target, amountMinor: minor }
							: e.target;
			} else if (e.target) target = e.target;
			envelopes.push({
				key: e.key,
				name: name(e.nameKey, e.name),
				groupKey: e.groupKey,
				kind: e.kind,
				isDefault: e.isDefault,
				categoryIds: e.categoryIds,
				...(target ? { target } : {}),
				...(e.sweepToKey && keep.some((k) => k.key === e.sweepToKey)
					? { sweepToKey: e.sweepToKey }
					: {}),
			});
		}
		const used = new Set(envelopes.map((e) => e.groupKey));
		const out: SetupInput = {
			style,
			groups: p.groups
				.filter((g) => used.has(g.key))
				.map((g) => ({
					key: g.key,
					name: name(g.nameKey, null),
					role: g.role,
					...(g.target ? { target: g.target } : {}),
				})),
			envelopes,
			...(p.rules?.length
				? {
						rules: p.rules
							.filter((r) => envelopes.some((e) => e.key === r.envelopeKey))
							.map(({ nameKey, ...r }) => ({
								...r,
								name: name(nameKey, null),
							})),
					}
				: {}),
		};
		if (style !== "LIMITS" && money.minor !== null)
			out.startingMoneyMinor = money.minor;
		return out;
	}, [p, off, texts, style, money.minor, locale, name]);

	return {
		setDone,
		style,
		setStyle,
		preset: p,
		loading: preset.isLoading,
		money,
		off,
		toggle,
		texts,
		setText,
		input: input && input.envelopes.length > 0 ? input : null,
		name,
	};
}
