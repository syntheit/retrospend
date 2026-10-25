"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { PaymentMethodIcon } from "~/components/ui/payment-method-icon";
import {
	getMethodsByRegion,
	type PaymentMethodTypeDef,
} from "~/lib/payment-method-registry";

function TypeGrid({
	types,
	onSelect,
}: {
	types: PaymentMethodTypeDef[];
	onSelect: (t: PaymentMethodTypeDef) => void;
}) {
	return (
		<div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
			{types.map((type) => (
				<Button
					className="h-auto flex-col gap-2 px-2 py-3"
					key={type.id}
					kind="secondary"
					onClick={() => onSelect(type)}
					type="button"
				>
					<PaymentMethodIcon size="md" typeId={type.id} />
					<span className="text-meta line-clamp-1">{type.name}</span>
				</Button>
			))}
		</div>
	);
}

function TypeSection({
	label,
	types,
	onSelect,
}: {
	label: string;
	types: PaymentMethodTypeDef[];
	onSelect: (t: PaymentMethodTypeDef) => void;
}) {
	return (
		<div>
			<h3 className="text-fg-2 text-small mb-2 font-semibold">{label}</h3>
			<TypeGrid onSelect={onSelect} types={types} />
		</div>
	);
}

/** Step one of adding a method: search, then pick a platform by region. */
export function TypePicker({
	userCurrency,
	onSelect,
}: {
	userCurrency: string;
	onSelect: (t: PaymentMethodTypeDef) => void;
}) {
	const t = useTranslations("settingsPage");
	const [search, setSearch] = useState("");
	const [showAllRegions, setShowAllRegions] = useState(false);
	const searchRef = useRef<HTMLInputElement>(null);
	const groups = useMemo(
		() => getMethodsByRegion(userCurrency),
		[userCurrency],
	);

	useEffect(() => {
		requestAnimationFrame(() => searchRef.current?.focus());
	}, []);

	const matches = useMemo(() => {
		if (!search.trim()) return null;
		const q = search.toLowerCase();
		const { regional, global, crypto, other } = groups;
		return [...regional, ...global, ...other, ...crypto].filter(
			(m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
		);
	}, [search, groups]);

	return (
		<div className="flex flex-col gap-4">
			<div className="relative">
				<Search
					aria-hidden="true"
					className="text-fg-3 absolute top-1/2 left-3 size-4 -translate-y-1/2"
				/>
				<Input
					aria-label={t("searchPlatforms")}
					className="h-ctl pl-9"
					onChange={(e) => setSearch(e.target.value)}
					placeholder={t("searchPlatforms")}
					ref={searchRef}
					value={search}
				/>
			</div>

			{matches ? (
				matches.length === 0 ? (
					<p className="text-fg-3 text-small py-4 text-center">
						{t("noMatchingPlatforms")}
					</p>
				) : (
					<TypeGrid onSelect={onSelect} types={matches} />
				)
			) : (
				<>
					{groups.regional.length > 0 && (
						<TypeSection
							label={t("yourRegion")}
							onSelect={onSelect}
							types={groups.regional}
						/>
					)}
					<TypeSection
						label={t("global")}
						onSelect={onSelect}
						types={groups.global}
					/>
					{!showAllRegions && groups.other.length > 0 && (
						<Button
							kind="ghost"
							onClick={() => setShowAllRegions(true)}
							type="button"
						>
							{t("showMoreRegions")}
						</Button>
					)}
					{showAllRegions && groups.other.length > 0 && (
						<TypeSection
							label={t("otherRegions")}
							onSelect={onSelect}
							types={groups.other}
						/>
					)}
					<TypeSection
						label={t("crypto")}
						onSelect={onSelect}
						types={groups.crypto}
					/>
				</>
			)}
		</div>
	);
}
