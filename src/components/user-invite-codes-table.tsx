import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import { format } from "date-fns";
import { Copy, Link, MoreHorizontal, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DataTable } from "~/components/data-table";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	ContextMenuItem,
	ContextMenuSeparator,
} from "~/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { useIsMobile } from "~/hooks/use-mobile";
import { api } from "~/trpc/react";

interface InviteCode {
	id: string;
	code: string;
	isActive: boolean;
	usedAt: Date | null;
	expiresAt: Date | null;
	createdAt: Date;
	createdBy: {
		username: string;
		name: string;
	};
	usedBy: {
		username: string;
		name: string;
	} | null;
	status: string;
}

interface UserInviteCodesTableProps {
	inviteCodes: InviteCode[];
	isLoading: boolean;
	status: "active" | "used";
	onStatusChange: (status: "active" | "used") => void;
	onGenerateCode: () => void;
	onDeleteCode: (inviteCodeId: string, code: string) => void;
}

export function UserInviteCodesTable({
	inviteCodes,
	isLoading,
	status,
	onStatusChange,
	onGenerateCode,
	onDeleteCode,
}: UserInviteCodesTableProps) {
	const t = useTranslations("inviteCodesTable");
	const [isGenerating, setIsGenerating] = useState(false);
	const generateMutation = api.invite.generateUserCode.useMutation();
	const isMobile = useIsMobile();

	const handleGenerateCode = async () => {
		setIsGenerating(true);
		try {
			const result = await generateMutation.mutateAsync();
			toast.success(t("newCodeGenerated", { code: result.code }));
			onGenerateCode();
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: t("generateFailed");
			toast.error(message);
		} finally {
			setIsGenerating(false);
		}
	};

	const columns = useMemo<ColumnDef<InviteCode>[]>(
		() => [
			{
				accessorKey: "code",
				header: t("code"),
				cell: ({ row }) => (
					<div className="flex items-center gap-2">
						<span className="font-medium font-mono">
							{row.original.code}
						</span>
						<CopyButton
							label={t("copyCode")}
							successLabel={t("codeCopied")}
							value={row.original.code}
						/>
						<CopyButton
							icon={Link}
							label={t("copySignupLink")}
							successLabel={t("linkCopied")}
							value={`${window.location.origin}/signup?code=${row.original.code}`}
						/>
					</div>
				),
			},
			{
				accessorKey: "status",
				header: t("status"),
				cell: ({ row }) => (
					<Badge
						variant={
							row.original.status === "Active" ? "default" : "secondary"
						}
					>
						{row.original.status}
					</Badge>
				),
			},
			{
				accessorKey: "createdAt",
				header: t("createdAt"),
				cell: ({ row }) =>
					format(new Date(row.original.createdAt), "MMM d, yyyy HH:mm"),
			},
			{
				id: "usedBy",
				header: t("usedBy"),
				cell: ({ row }) =>
					row.original.usedBy ? (
						<div className="flex flex-col">
							<span className="font-medium">
								@{row.original.usedBy.username}
							</span>
							<span className="text-muted-foreground text-sm">
								{row.original.usedBy.name}
							</span>
						</div>
					) : (
						<span className="text-muted-foreground">-</span>
					),
			},
			{
				id: "usedAt",
				header: t("usedAt"),
				cell: ({ row }) =>
					row.original.usedAt ? (
						format(new Date(row.original.usedAt), "MMM d, yyyy HH:mm")
					) : (
						<span className="text-muted-foreground">-</span>
					),
			},
			{
				id: "actions",
				header: () => null,
				enableSorting: false,
				enableHiding: false,
				size: 48,
				cell: ({ row }) => (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								className="h-7 w-7 md:opacity-0 transition-opacity md:group-hover:opacity-100"
								size="icon"
								variant="ghost"
							>
								<MoreHorizontal className="h-4 w-4" />
								<span className="sr-only">{t("actions")}</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-44">
							<DropdownMenuItem
								onClick={() => {
									void navigator.clipboard.writeText(row.original.code);
									toast.success(t("codeCopiedToast"));
								}}
							>
								<Copy className="mr-2 h-4 w-4" />
								{t("copyCode")}
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={() => {
									void navigator.clipboard.writeText(
										`${window.location.origin}/signup?code=${row.original.code}`,
									);
									toast.success(t("signupLinkCopied"));
								}}
							>
								<Link className="mr-2 h-4 w-4" />
								{t("copySignupLink")}
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								onClick={() => onDeleteCode(row.original.id, row.original.code)}
								variant="destructive"
							>
								<Trash2 className="mr-2 h-4 w-4" />
								{t("delete")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				),
			},
		],
		[onDeleteCode, t],
	);

	const columnVisibility: VisibilityState = isMobile
		? { usedBy: false, usedAt: false }
		: {};

	const renderContextMenu = useMemo(() => {
		return (row: InviteCode) => (
			<>
				<ContextMenuItem
					className="cursor-pointer"
					onClick={async () => {
						try {
							await navigator.clipboard.writeText(row.code);
							toast.success(t("inviteCodeCopied"));
						} catch {
							toast.error(t("copyCodeFailed"));
						}
					}}
				>
					<Copy className="mr-2 h-4 w-4" />
					{t("copyCode")}
				</ContextMenuItem>
				<ContextMenuItem
					className="cursor-pointer"
					onClick={async () => {
						try {
							const inviteUrl = `${window.location.origin}/signup?code=${row.code}`;
							await navigator.clipboard.writeText(inviteUrl);
							toast.success(t("inviteLinkCopied"));
						} catch {
							toast.error(t("copyLinkFailed"));
						}
					}}
				>
					<Link className="mr-2 h-4 w-4" />
					{t("copySignupLink")}
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem
					className="cursor-pointer text-destructive focus:text-destructive"
					onClick={() => onDeleteCode(row.id, row.code)}
				>
					<Trash2 className="mr-2 h-4 w-4" />
					{t("delete")}
				</ContextMenuItem>
			</>
		);
	}, [onDeleteCode, t]);

	const emptyState = (
		<div className="py-8 text-muted-foreground text-sm">
			{status === "active"
				? t("noActiveCodes")
				: t("noUsedCodes")}
		</div>
	);

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="font-medium text-lg">{t("myInviteCodes")}</h3>
					<p className="text-muted-foreground text-sm">
						{t("manageDescription")}
					</p>
				</div>
				{status === "active" && (
					<Button
						disabled={isGenerating || isLoading}
						onClick={handleGenerateCode}
					>
						{isGenerating ? t("generating") : t("generateNew")}
					</Button>
				)}
			</div>

			<Tabs
				onValueChange={(value) => onStatusChange(value as "active" | "used")}
				value={status}
			>
				<TabsList className="mb-4">
					<TabsTrigger value="active">{t("active")}</TabsTrigger>
					<TabsTrigger value="used">{t("used")}</TabsTrigger>
				</TabsList>

				<DataTable
					columns={columns}
					columnVisibility={columnVisibility}
					countNoun="codes"
					data={inviteCodes}
					emptyState={emptyState}
					progressive
					renderContextMenu={renderContextMenu}
					searchable
					searchPlaceholder={t("searchPlaceholder")}
				/>
			</Tabs>
		</div>
	);
}

function CopyButton({
	value,
	label,
	successLabel,
	icon: Icon = Copy,
}: {
	value: string;
	label: string;
	successLabel: string;
	icon?: React.ElementType;
}) {
	const t = useTranslations("inviteCodesTable");
	const [isOpen, setIsOpen] = useState(false);
	const [hasCopied, setHasCopied] = useState(false);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(value);
			setHasCopied(true);
			setIsOpen(true);
			toast.success(successLabel);
			setTimeout(() => {
				setHasCopied(false);
				setIsOpen(false);
			}, 2000);
		} catch {
			toast.error(t("copyFailed"));
		}
	};

	return (
		<Tooltip onOpenChange={setIsOpen} open={isOpen}>
			<TooltipTrigger asChild>
				<Button
					className="h-6 w-6 p-0"
					onClick={handleCopy}
					onMouseEnter={() => {
						if (!hasCopied) setIsOpen(true);
					}}
					onMouseLeave={() => {
						if (!hasCopied) setIsOpen(false);
					}}
					size="sm"
					variant="ghost"
				>
					<Icon className="h-3 w-3" />
				</Button>
			</TooltipTrigger>
			<TooltipContent>{hasCopied ? successLabel : label}</TooltipContent>
		</Tooltip>
	);
}
