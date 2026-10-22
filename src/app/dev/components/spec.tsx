"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Notice } from "~/components/ui/notice";
import { cn } from "~/lib/cn";
import { CAP, type GallerySection, SECTIONS } from "./sections";

/** The section's documentation header, then its content (kit `.g-spec`). */
export function Spec({ id, children }: { id: string; children?: ReactNode }) {
	const t = useTranslations("gallery");
	const s = SECTIONS.find((x) => x.id === id) as GallerySection;
	return (
		<section aria-labelledby={`${id}-h`} className="mt-12 scroll-mt-4" id={id}>
			<h3 className="text-fg text-section" id={`${id}-h`}>
				{s.title}
			</h3>
			<p className="text-fg-2 text-small mt-0.5 mb-3 max-w-190">
				<b className="text-fg font-semibold">{t("useFor")}</b> {s.use}{" "}
				<b className="text-fg font-semibold">{t("neverFor")}</b> {s.never}
			</p>
			<p className="text-fg-3 text-meta mb-3">
				{t("replaces")} {s.replaces}
			</p>
			{s.pending && (
				<Notice className="mb-4" tone="info">
					{s.pending}
				</Notice>
			)}
			{children}
		</section>
	);
}

/** A small fg-3 caption over a cell. */
export function Cap({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<span className={cn("text-fg-3 text-meta mb-2 block", className)}>
			{children}
		</span>
	);
}

/** The 390px phone frame, as components.html draws it. */
export function Phone({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"rounded-panel border-line-strong bg-bg relative w-full max-w-98 border border-dashed px-4 py-3",
				className,
			)}
		>
			{children}
		</div>
	);
}

/** Desktop on the left, phone on the right (stacked on a phone). */
export function Pair({
	desktop,
	phone,
	desktopCap = CAP.desktop,
	phoneCap = CAP.phone,
}: {
	desktop: ReactNode;
	phone: ReactNode;
	desktopCap?: string;
	phoneCap?: string;
}) {
	return (
		<div className="grid items-start gap-6 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
			<div className="min-w-0">
				<Cap>{desktopCap}</Cap>
				{desktop}
			</div>
			<div className="min-w-0">
				<Cap>{phoneCap}</Cap>
				<Phone>{phone}</Phone>
			</div>
		</div>
	);
}

/** A wrapping row of labelled states (kit `.g-states`). */
export function States({
	items,
	className,
}: {
	items: [label: string, node: ReactNode][];
	className?: string;
}) {
	return (
		<div className={cn("flex flex-wrap items-end gap-x-6 gap-y-4", className)}>
			{items.map(([label, node]) => (
				<div className="flex flex-col items-start gap-2" key={label}>
					<Cap className="mb-0">{label}</Cap>
					{node}
				</div>
			))}
		</div>
	);
}
