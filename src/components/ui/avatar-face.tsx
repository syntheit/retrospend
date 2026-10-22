"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Tip } from "~/components/ui/tooltip";
import { Money } from "~/components/money/money";
import type { MoneyValue } from "~/components/money/format";
import { cn } from "~/lib/cn";

export type FaceSize = "xs" | "sm" | "default" | "md" | "lg";

/** xs 22, sm 24, default 32, md 40, lg 48 (GUIDELINE §8). */
const BOX: Record<FaceSize, string> = {
	xs: "size-5.5",
	sm: "size-6",
	default: "size-8",
	md: "size-10",
	lg: "size-12",
};
const TEXT: Record<FaceSize, string> = {
	xs: "text-meta",
	sm: "text-meta",
	default: "text-meta",
	md: "text-small",
	lg: "text-body",
};
/** The +N chip keeps the face height and grows sideways. */
const HEIGHT: Record<FaceSize, string> = {
	xs: "h-5.5 min-w-5.5",
	sm: "h-6 min-w-6",
	default: "h-8 min-w-8",
	md: "h-10 min-w-10",
	lg: "h-12 min-w-12",
};

const COLOR = [
	"bg-avatar-1",
	"bg-avatar-2",
	"bg-avatar-3",
	"bg-avatar-4",
	"bg-avatar-5",
	"bg-avatar-6",
	"bg-avatar-7",
	"bg-avatar-8",
] as const;

/** A person's color: the sum of the name's char codes mod 8, so it never changes. */
export function faceColor(name: string): (typeof COLOR)[number] {
	let sum = 0;
	for (const ch of name) sum += ch.codePointAt(0) ?? 0;
	return COLOR[sum % COLOR.length] ?? COLOR[0];
}

/** Two letters: first and last word, or the first two letters of one word. */
export function initialsOf(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	const first = words[0] ?? "?";
	const last = words.length > 1 ? words[words.length - 1] : undefined;
	const pick = last
		? [...first][0] + ([...last][0] ?? "")
		: [...first].slice(0, 2).join("");
	return pick.toLocaleUpperCase();
}

/**
 * Face (R20): one person's profile picture, or their initials in white on
 * their avatar color when they have none (people not on Retrospend).
 */
export function Face({
	name,
	imageUrl,
	size = "default",
	className,
}: {
	name: string;
	imageUrl?: string | null;
	size?: FaceSize;
	className?: string;
}) {
	return (
		<Avatar className={cn("rounded-chip", BOX[size], TEXT[size], className)}>
			{imageUrl && <AvatarImage alt="" src={imageUrl} />}
			<AvatarFallback
				// White on every avatar color in both themes (UI-004 checks it).
				// No token names that job yet: brand-fg is white in light and
				// fg is near white in dark. See the S1a report.
				className={cn(
					"rounded-chip font-semibold text-brand-fg dark:text-fg",
					faceColor(name),
				)}
			>
				{initialsOf(name)}
			</AvatarFallback>
		</Avatar>
	);
}

export type FacePerson = {
	id: string;
	name: string;
	imageUrl?: string | null;
	/** The viewer: named "You" and never ringed as the payer. */
	isSelf?: boolean;
	/** Their share, shown in the face's tooltip. */
	share?: MoneyValue;
};

/** Payer first, everyone else in the order given. */
export function orderFaces(people: FacePerson[], payerId?: string) {
	if (!payerId) return people;
	const payer = people.filter((p) => p.id === payerId);
	return [...payer, ...people.filter((p) => p.id !== payerId)];
}

/** Who shows and how many fold into +N: max faces, the last slot is +N. */
export function splitFaces(people: FacePerson[], max: number) {
	if (people.length <= max) return { shown: people, rest: [] as FacePerson[] };
	return { shown: people.slice(0, max - 1), rest: people.slice(max - 1) };
}

const OVERLAP: Record<FaceSize, string> = {
	xs: "-ml-1",
	sm: "-ml-1",
	default: "-ml-1",
	md: "-ml-2",
	lg: "-ml-2",
};

/**
 * FaceStack (R20, GUIDELINE §8): the faces of a set of people. Overlaps, and
 * spreads on hover (fine pointers) with one tooltip per face (name, Paid,
 * share), ends with +N. The payer comes first, with an accent ring when
 * someone else paid. `names` is the Names setting: plain names instead.
 */
export function FaceStack({
	people,
	payerId,
	max = 4,
	size = "xs",
	names = false,
	on = "bg",
	className,
}: {
	people: FacePerson[];
	payerId?: string;
	max?: number;
	size?: FaceSize;
	names?: boolean;
	/** The fill behind the stack, for the separating ring. */
	on?: "bg" | "surface";
	className?: string;
}) {
	const t = useTranslations("kit.faces");
	const format = useFormatter();
	const ordered = orderFaces(people, payerId);
	if (!ordered.length) return null;
	const nameOf = (p: FacePerson) => (p.isSelf ? t("you") : p.name);
	const all = format.list(ordered.map(nameOf), { type: "conjunction" });

	if (names) {
		const [a, b] = ordered;
		const text =
			ordered.length > 3 && a && b
				? t("someAndMore", {
						first: nameOf(a),
						second: nameOf(b),
						count: ordered.length - 2,
					})
				: all;
		return <span className={className}>{text}</span>;
	}

	const { shown, rest } = splitFaces(ordered, max);
	const ring = on === "bg" ? "ring-bg" : "ring-surface";
	const spread = cn(
		OVERLAP[size],
		"transition-[margin] duration-(--t-state) ease-land can-hover:group-hover/faces:ml-1",
	);

	return (
		<span
			aria-label={all}
			className={cn(
				"group/faces inline-flex shrink-0 items-center align-middle",
				className,
			)}
			role="img"
		>
			{shown.map((p, i) => {
				const paid = p.id === payerId;
				return (
					<Tip
						content={
							<>
								{nameOf(p)}
								{paid && ` · ${t("paid")}`}
								{p.share && (
									<>
										{" · "}
										<Money value={p.share} />
									</>
								)}
							</>
						}
						key={p.id}
					>
						<span
							className={cn(
								"inline-flex rounded-chip ring-2",
								ring,
								i > 0 && spread,
								paid &&
									!p.isSelf &&
									"ring-ds-accent ring-offset-2 ring-offset-bg",
							)}
						>
							<Face imageUrl={p.imageUrl} name={p.name} size={size} />
						</span>
					</Tip>
				);
			})}
			{rest.length > 0 && (
				<Tip content={format.list(rest.map(nameOf), { type: "conjunction" })}>
					<span
						className={cn(
							"inline-flex items-center justify-center rounded-chip bg-raised px-1 font-medium text-fg-2 text-meta tabular-nums ring-2",
							HEIGHT[size],
							ring,
							spread,
						)}
					>
						+{rest.length}
					</span>
				</Tip>
			)}
		</span>
	);
}
