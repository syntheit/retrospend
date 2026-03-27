"use client";

import {
	Check,
	ChevronRight,
	Copy,
	ExternalLink,
	Loader2,
	RefreshCw,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { use, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Collapsible, CollapsibleContent } from "~/components/ui/collapsible";
import { CurrencyBackground } from "~/components/currency-background";
import {
	PaymentMethodIcon,
	getPaymentMethodName,
} from "~/components/ui/payment-method-icon";
import { UserAvatar } from "~/components/ui/user-avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { env } from "~/env";
import { buildPaymentLink } from "~/lib/payment-links";
import {
	resolveMethodTypeId,
	getMethodType,
} from "~/lib/payment-method-registry";

import { api } from "~/trpc/react";

type PageParams = Promise<{ username: string }>;

function truncateCrypto(address: string): string {
	if (address.length <= 12) return address;
	return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function CopyButton({ text, label }: { text: string; label?: string }) {
	const [copied, setCopied] = useState(false);

	return (
		<Button
			aria-label={label ?? "Copy"}
			className="h-8 w-8 shrink-0 p-0"
			onClick={() => {
				void navigator.clipboard.writeText(text);
				setCopied(true);
				toast.success("Copied!");
				setTimeout(() => setCopied(false), 2000);
			}}
			size="sm"
			variant="ghost"
		>
			{copied ? (
				<Check className="h-3.5 w-3.5 text-emerald-500" />
			) : (
				<Copy className="h-3.5 w-3.5" />
			)}
		</Button>
	);
}

function ProfileSkeleton() {
	return (
		<div className="flex h-dvh items-center justify-center overflow-y-auto p-4">
			<div className="flex w-full max-w-[500px] flex-col gap-3">
				<Card>
					<CardContent className="space-y-4 p-5 sm:p-6">
						<div className="flex flex-col items-center gap-2">
							<Skeleton className="h-20 w-20 rounded-full" />
							<Skeleton className="h-6 w-40" />
							<Skeleton className="h-4 w-32" />
						</div>
						<Skeleton className="h-11 w-full" />
						<div className="border-t" />
						<div className="space-y-2">
							<Skeleton className="h-16 w-full rounded-lg" />
							<Skeleton className="h-16 w-full rounded-lg" />
							<Skeleton className="h-16 w-full rounded-lg" />
						</div>
					</CardContent>
				</Card>
				<Skeleton className="h-24 w-full rounded-xl" />
			</div>
		</div>
	);
}

type PaymentMethod = {
	id: string;
	type: string;
	label: string | null;
	identifier: string | null;
	currency: string | null;
	network: string | null;
	rank: number;
};

function PaymentMethodChip({
	method,
	isFirst,
	isSelected,
	onSelect,
}: {
	method: PaymentMethod;
	isFirst: boolean;
	isSelected: boolean;
	onSelect: () => void;
}) {
	const resolvedType = resolveMethodTypeId(method.type, method.currency);
	const def = getMethodType(resolvedType);
	const displayName = getPaymentMethodName(method.type, method.label, method.currency);

	return (
		<button
			onClick={onSelect}
			className="flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-muted/50"
			style={isSelected ? { borderColor: def?.iconFallbackColor ?? "#6B7280", backgroundColor: `${def?.iconFallbackColor ?? "#6B7280"}10` } : {}}
		>
			<PaymentMethodIcon currency={method.currency} size="sm" typeId={method.type} />
			<span className="font-medium text-sm">{displayName}</span>
			{isFirst && <span className="text-amber-500 text-xs" title="Preferred">★</span>}
		</button>
	);
}

function PaymentMethodDetail({
	method,
	isFirst,
}: {
	method: PaymentMethod;
	isFirst: boolean;
}) {
	const [linkState, setLinkState] = useState<"idle" | "opening">("idle");

	const resolvedType = resolveMethodTypeId(method.type, method.currency);
	const def = getMethodType(resolvedType);
	const isCrypto = def?.category === "crypto" || method.type.toLowerCase() === "crypto";
	const isCash = method.type.toLowerCase() === "cash";
	const displayName = getPaymentMethodName(method.type, method.label, method.currency);
	const networkDef =
		isCrypto && method.network
			? def?.networks?.find(
					(n) =>
						n.id === method.network ||
						n.shortName === method.network ||
						n.name === method.network,
				)
			: null;

	const link = useMemo(
		() => buildPaymentLink(method.type, method.identifier, 0, "", { currency: method.currency, network: method.network }),
		[method.type, method.identifier, method.currency, method.network],
	);

	const handleOpenLink = () => {
		const url = link.url ?? link.webUrl;
		if (url) {
			window.open(url, "_blank");
			setLinkState("opening");
			setTimeout(() => setLinkState("idle"), 3000);
		}
	};

	return (
		<div
			className="mt-2 rounded-lg border border-l-[3px] px-3 py-2.5"
			style={{ borderLeftColor: def?.iconFallbackColor ?? "#6B7280" }}
		>
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-1.5">
						<span className="font-medium text-sm">{displayName}</span>
						{isFirst && <Badge className="text-[10px]" variant="secondary">Preferred</Badge>}
					</div>
					{networkDef && (
						<p className="text-muted-foreground text-xs">{networkDef.shortName}</p>
					)}
					{method.identifier && !isCash && (
						<p className="mt-0.5 break-all font-mono text-muted-foreground text-xs">
							{isCrypto ? truncateCrypto(method.identifier) : method.identifier}
						</p>
					)}
					{link.instructions && (
						<p className="mt-1 text-muted-foreground text-xs">{link.instructions}</p>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-0.5">
					{link.canDeepLink && (link.url ?? link.webUrl) && (
						<Button className="h-8 gap-1 px-2.5 text-xs" onClick={handleOpenLink} size="sm">
							{linkState === "opening" ? (
								<Loader2 className="h-3 w-3 animate-spin" />
							) : (
								<>Open<ExternalLink className="h-3 w-3" /></>
							)}
						</Button>
					)}
					{method.identifier && !isCash && (
						<CopyButton label={`Copy ${displayName} identifier`} text={method.identifier} />
					)}
				</div>
			</div>
		</div>
	);
}

export default function PublicProfilePage({
	params,
}: {
	params: PageParams;
}) {
	const { username } = use(params);
	const router = useRouter();
	const searchParams = useSearchParams();
	const isDonate = searchParams.has("donate");
	const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null);
	const lastMethodRef = useRef<{ method: PaymentMethod; isFirst: boolean } | null>(null);
	const { data, isLoading, isError, error, refetch } =
		api.profile.publicProfile.useQuery({ username }, { retry: false });

	useEffect(() => {
		if (data && "redirect" in data && data.redirect) {
			router.replace(`/u/${data.redirect}`);
		}
	}, [data, router]);

	if (isLoading) return <ProfileSkeleton />;

	if (data && "redirect" in data) return <ProfileSkeleton />;

	if (isError || !data) {
		const isNotFound =
			(error as { data?: { httpStatus?: number } } | null)?.data?.httpStatus ===
			404;

		return (
			<div className="flex h-dvh items-center justify-center overflow-y-auto p-4">
				<Card className="w-full max-w-[500px]">
					<CardContent className="space-y-4 p-5 text-center sm:p-6">
						<h1 className="font-bold text-xl">
							{isNotFound ? "This profile doesn't exist" : "Something went wrong"}
						</h1>
						<p className="text-muted-foreground text-sm">
							{isNotFound
								? "Check the username and try again, or search for them on Retrospend."
								: "We couldn't load this profile. Please try again."}
						</p>
						<div className="flex justify-center gap-3">
							{!isNotFound && (
								<Button onClick={() => void refetch()} variant="outline">
									<RefreshCw className="mr-1.5 h-4 w-4" />
									Try again
								</Button>
							)}
							<Button asChild variant={isNotFound ? "default" : "outline"}>
								<Link href="/">
									Go to Retrospend
									<ExternalLink className="ml-1.5 h-4 w-4" />
								</Link>
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	const firstName = data.displayName.split(" ")[0] ?? data.displayName;
	const profileUrl = `${env.NEXT_PUBLIC_APP_URL}/u/${data.username}`;

	return (
		<div className="relative h-dvh overflow-y-auto">
			<CurrencyBackground
				animation={data.backgroundSettings.animation}
				color={data.backgroundSettings.color}
				density={data.backgroundSettings.density}
				opacity={data.backgroundSettings.opacity}
				seed={data.username}
				symbolSets={data.backgroundSettings.symbolSets}
			/>
			<div className="relative z-10 flex min-h-dvh flex-col items-center justify-center gap-3 p-4">
			<div className="flex w-full max-w-[500px] flex-col gap-3">
				{/* Main Profile Card */}
				<Card className="border-border/40 bg-card/60 backdrop-blur-xl">
					<CardContent className="p-5 sm:p-6">
						{/* Header */}
						<div className="flex flex-col items-center gap-1 text-center">
							<UserAvatar
								avatarUrl={data.avatar}
								name={data.displayName}
								size="xl"
							/>
							<h1 className="mt-2 font-bold text-2xl">{data.displayName}</h1>
							<p className="text-muted-foreground text-sm">
								@{data.username} · Member since{" "}
								{new Date(data.memberSince).toLocaleDateString(undefined, {
									month: "short",
									year: "numeric",
								})}
							</p>
						</div>

						{/* Pay / Donate CTA */}
						<Button asChild className="mt-5 w-full" size="lg">
							<Link href={`/pay/${data.username}${isDonate ? "?donate" : ""}`}>
								{isDonate ? `Donate to ${firstName}` : `Pay ${firstName}`}
							</Link>
						</Button>

						{/* Divider */}
						<div className="mt-4 mb-3 border-t border-border/50" />

						{/* Payment Methods */}
						{data.publicMethods.length > 0 ? (
							<div>
								<h2 className="mb-2 font-semibold text-muted-foreground text-sm">
									{isDonate ? "Accepts donations via" : "Accepts payments via"}
								</h2>
								<div className="flex flex-wrap gap-2">
									{data.publicMethods.map((method, i) => (
										<PaymentMethodChip
											isFirst={i === 0}
											isSelected={selectedMethodId === method.id}
											key={method.id}
											method={method}
											onSelect={() =>
												setSelectedMethodId(
													selectedMethodId === method.id ? null : method.id,
												)
											}
										/>
									))}
								</div>
								{(() => {
									const idx = data.publicMethods.findIndex((m) => m.id === selectedMethodId);
									const selected = data.publicMethods[idx];
									if (selected) {
										lastMethodRef.current = { method: selected, isFirst: idx === 0 };
									}
									const display = selected ? { method: selected, isFirst: idx === 0 } : lastMethodRef.current;
									return (
										<Collapsible open={!!selected}>
											<CollapsibleContent>
												{display && (
													<PaymentMethodDetail isFirst={display.isFirst} method={display.method} />
												)}
											</CollapsibleContent>
										</Collapsible>
									);
								})()}
							</div>
						) : (
							<p className="py-4 text-center text-muted-foreground text-sm">
								{firstName} hasn&apos;t added any public payment methods yet.
							</p>
						)}

						{/* QR Code - desktop only */}
						<div className="mt-5 hidden flex-col items-center gap-2 sm:flex">
							<div className="rounded-lg bg-transparent p-2">
								<QRCodeSVG
									bgColor="transparent"
									fgColor="#e5e5e5"
									level="M"
									size={100}
									value={profileUrl}
								/>
							</div>
							<p className="text-muted-foreground text-xs">
								{isDonate ? "Scan to donate" : "Scan to pay"}
							</p>
						</div>
					</CardContent>
				</Card>

				{/* Branded Footer */}
				<Card className="border-border/40 bg-muted/20 backdrop-blur-xl">
					<CardContent className="flex flex-col items-center gap-2 p-4 text-center">
						<div className="flex items-center gap-2">
							<Image
								alt="Retrospend"
								className="rounded-sm"
								height={20}
								src="/favicon-32x32.png"
								width={20}
							/>
							<span className="font-bold text-sm tracking-tight">
								Retrospend
							</span>
						</div>
						<p className="text-muted-foreground text-xs">
							Split and track expenses with anyone
						</p>
						<Button asChild className="mt-1 gap-1" size="sm">
							<Link href="/signup">
								Get started free
								<ChevronRight className="h-3.5 w-3.5" />
							</Link>
						</Button>
					</CardContent>
				</Card>
			</div>
			</div>
		</div>
	);
}
