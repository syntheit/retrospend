import { format } from "date-fns";
import { ChevronLeft, ChevronRight, Copy, Link, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";
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

interface PaginationData {
	totalCount: number;
	page: number;
	pageSize: number;
	totalPages: number;
}

interface InviteCodesTableProps {
	inviteCodes: InviteCode[];
	isLoading: boolean;
	pagination?: PaginationData;
	status: "active" | "used";
	onStatusChange: (status: "active" | "used") => void;
	onPageChange: (page: number) => void;
	onGenerateCode: () => void;
	onDeleteCode: (inviteCodeId: string, code: string) => void;
}

export function InviteCodesTable({
	inviteCodes,
	isLoading,
	pagination,
	status,
	onStatusChange,
	onPageChange,
	onGenerateCode,
	onDeleteCode,
}: InviteCodesTableProps) {
	const generateMutation = api.invite.generate.useMutation();

	const handleGenerateCode = async () => {
		try {
			const result = await generateMutation.mutateAsync();
			toast.success(`New invite code generated: ${result.code}`);
			onGenerateCode();
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "Failed to generate invite code";
			toast.error(message);
		}
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="font-medium text-lg">Invite Codes</h3>
					<p className="text-muted-foreground text-sm">
						Manage invite codes for new user registrations.
					</p>
				</div>
				{status === "active" && (
					<Button
						disabled={generateMutation.isPending || isLoading}
						onClick={handleGenerateCode}
					>
						{generateMutation.isPending ? "Generating..." : "Generate New Code"}
					</Button>
				)}
			</div>

			<Tabs
				onValueChange={(value) => onStatusChange(value as "active" | "used")}
				value={status}
			>
				<TabsList className="mb-4">
					<TabsTrigger value="active">Active</TabsTrigger>
					<TabsTrigger value="used">Used</TabsTrigger>
				</TabsList>

				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Code</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Created By</TableHead>
								<TableHead>Created At</TableHead>
								<TableHead>Used By</TableHead>
								<TableHead>Used At</TableHead>
								<TableHead>Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{isLoading ? (
								<TableRow>
									<TableCell className="text-center" colSpan={7}>
										Loading...
									</TableCell>
								</TableRow>
							) : inviteCodes.length === 0 ? (
								<TableRow>
									<TableCell
										className="text-center text-muted-foreground"
										colSpan={7}
									>
										{status === "active"
											? "No active invite codes found. Generate your first code to get started."
											: "No used invite codes found."}
									</TableCell>
								</TableRow>
							) : (
								inviteCodes.map((inviteCode) => (
									<TableRow key={inviteCode.id}>
										<TableCell className="font-medium font-mono">
											<div className="flex items-center gap-2">
												<span>{inviteCode.code}</span>
												<CopyButton
													label="Copy Code"
													successLabel="Code Copied 🎉"
													value={inviteCode.code}
												/>
												<CopyButton
													icon={Link}
													label="Copy Link"
													successLabel="Link Copied 🎉"
													value={`${window.location.origin}/signup?code=${inviteCode.code}`}
												/>
											</div>
										</TableCell>
										<TableCell>
											<Badge
												variant={
													inviteCode.status === "Active"
														? "default"
														: "secondary"
												}
											>
												{inviteCode.status}
											</Badge>
										</TableCell>
										<TableCell>
											<div className="flex flex-col">
												<span className="font-medium">
													@{inviteCode.createdBy.username}
												</span>
												<span className="text-muted-foreground text-sm">
													{inviteCode.createdBy.name}
												</span>
											</div>
										</TableCell>
										<TableCell>
											{format(
												new Date(inviteCode.createdAt),
												"MMM dd, yyyy HH:mm",
											)}
										</TableCell>
										<TableCell>
											{inviteCode.usedBy ? (
												<div className="flex flex-col">
													<span className="font-medium">
														@{inviteCode.usedBy.username}
													</span>
													<span className="text-muted-foreground text-sm">
														{inviteCode.usedBy.name}
													</span>
												</div>
											) : (
												<span className="text-muted-foreground">-</span>
											)}
										</TableCell>
										<TableCell>
											{inviteCode.usedAt ? (
												format(
													new Date(inviteCode.usedAt),
													"MMM dd, yyyy HH:mm",
												)
											) : (
												<span className="text-muted-foreground">-</span>
											)}
										</TableCell>
										<TableCell>
											<Button
												className="h-6 w-6 p-0 text-destructive hover:text-destructive"
												onClick={() =>
													onDeleteCode(inviteCode.id, inviteCode.code)
												}
												size="sm"
												title="Delete invite code"
												variant="ghost"
											>
												<Trash2 className="h-3 w-3" />
											</Button>
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</div>
			</Tabs>

			{pagination && pagination.totalPages > 1 && (
				<div className="flex items-center justify-between">
					<p className="text-muted-foreground text-sm">
						Showing {(pagination.page - 1) * pagination.pageSize + 1} to{" "}
						{Math.min(
							pagination.page * pagination.pageSize,
							pagination.totalCount,
						)}{" "}
						of {pagination.totalCount} codes
					</p>
					<div className="flex items-center gap-2">
						<Button
							disabled={pagination.page <= 1}
							onClick={() => onPageChange(pagination.page - 1)}
							size="sm"
							variant="outline"
						>
							<ChevronLeft className="mr-2 h-4 w-4" />
							Previous
						</Button>
						<div className="flex items-center gap-1">
							<span className="text-sm">
								Page {pagination.page} of {pagination.totalPages}
							</span>
						</div>
						<Button
							disabled={pagination.page >= pagination.totalPages}
							onClick={() => onPageChange(pagination.page + 1)}
							size="sm"
							variant="outline"
						>
							Next
							<ChevronRight className="ml-2 h-4 w-4" />
						</Button>
					</div>
				</div>
			)}
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
			toast.error("Failed to copy to clipboard");
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
