"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import {
	Bot,
	CircleCheck,
	CircleX,
	Landmark,
	Link,
	Lock,
	LockOpen,
	MailCheck,
	MailWarning,
	MoreHorizontal,
	PieChart,
	RefreshCw,
	Repeat,
	ShieldCheck,
	Trash2,
} from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "~/components/ui/tooltip";

export interface User {
	id: string;
	username: string;
	email: string;
	emailVerified: boolean;
	role: "ADMIN" | "USER";
	isActive: boolean;
	expenseCount: number;
	inviteCodesCount: number;
	createdAt: Date;
	lastExpenseDate: Date | null;
	hasBudget: boolean;
	hasRecurring: boolean;
	hasWealth: boolean;
	twoFactorEnabled: boolean;
	externalAiAllowed: boolean | null;
}

export function createUserColumns(
	currentUserId: string | undefined,
	callbacks: {
		onResetPassword: (userId: string, username: string) => void;
		onToggleUserStatus: (
			userId: string,
			username: string,
			isActive: boolean,
		) => void;
		onMarkEmailVerified: (
			userId: string,
			username: string,
			verified: boolean,
		) => void;
		onDeleteUser: (userId: string, username: string) => void;
		onSetAiAccess?: (userId: string, allowed: boolean | null) => void;
		onCopyResetLink: (userId: string) => void;
	},
): ColumnDef<User>[] {
	return [
		{
			accessorKey: "username",
			header: "Username",
			enableSorting: true,
			meta: { flex: true },
			cell: ({ row }) => (
				<span className="font-medium">@{row.original.username}</span>
			),
		},
		{
			accessorKey: "email",
			header: "Email",
			enableSorting: true,
			meta: { flex: true },
			cell: ({ row }) => (
				<span className="text-muted-foreground">
					<span className="flex items-center gap-1.5">
						{row.original.email}
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									{row.original.emailVerified ? (
										<CircleCheck className="h-3.5 w-3.5 text-emerald-500" />
									) : (
										<CircleX className="h-3.5 w-3.5 text-muted-foreground/50" />
									)}
								</TooltipTrigger>
								<TooltipContent>
									{row.original.emailVerified
										? "Email verified"
										: "Email not verified"}
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					</span>
				</span>
			),
		},
		{
			accessorKey: "role",
			header: "Role",
			enableSorting: true,
			size: 100,
			cell: ({ row }) => (
				<Badge
					variant={row.original.role === "ADMIN" ? "default" : "secondary"}
				>
					{row.original.role}
				</Badge>
			),
		},
		{
			id: "status",
			header: "Status",
			enableSorting: true,
			size: 100,
			accessorFn: (row) => {
				if (!row.isActive) return "Disabled";
				const daysSinceLastExpense = row.lastExpenseDate
					? Math.floor(
							(Date.now() - new Date(row.lastExpenseDate).getTime()) /
								(1000 * 60 * 60 * 24),
						)
					: Number.POSITIVE_INFINITY;
				return daysSinceLastExpense > 14 ? "Dormant" : "Active";
			},
			cell: ({ row }) => {
				const daysSinceLastExpense = row.original.lastExpenseDate
					? Math.floor(
							(Date.now() -
								new Date(row.original.lastExpenseDate).getTime()) /
								(1000 * 60 * 60 * 24),
						)
					: Number.POSITIVE_INFINITY;
				const isDormant = daysSinceLastExpense > 14;

				if (!row.original.isActive) {
					return <Badge variant="destructive">Disabled</Badge>;
				}
				if (isDormant) {
					return (
						<Badge className="border-transparent bg-yellow-500/10 text-yellow-500 shadow-none hover:bg-yellow-500/20">
							Dormant
						</Badge>
					);
				}
				return (
					<Badge className="border-transparent bg-emerald-500/10 text-emerald-500 shadow-none hover:bg-emerald-500/20">
						Active
					</Badge>
				);
			},
		},
		{
			id: "features",
			header: "Features",
			enableSorting: false,
			size: 140,
			cell: ({ row }) => (
				<TooltipProvider>
					<div className="flex items-center gap-2">
						<Tooltip>
							<TooltipTrigger asChild>
								<PieChart
									className={`h-4 w-4 ${
										row.original.hasBudget
											? "text-primary"
											: "text-muted-foreground/30"
									}`}
								/>
							</TooltipTrigger>
							<TooltipContent>
								Budget: {row.original.hasBudget ? "Active" : "Unused"}
							</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Repeat
									className={`h-4 w-4 ${
										row.original.hasRecurring
											? "text-primary"
											: "text-muted-foreground/30"
									}`}
								/>
							</TooltipTrigger>
							<TooltipContent>
								Recurring: {row.original.hasRecurring ? "Active" : "Unused"}
							</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Landmark
									className={`h-4 w-4 ${
										row.original.hasWealth
											? "text-primary"
											: "text-muted-foreground/30"
									}`}
								/>
							</TooltipTrigger>
							<TooltipContent>
								Wealth: {row.original.hasWealth ? "Active" : "Unused"}
							</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<ShieldCheck
									className={`h-4 w-4 ${
										row.original.twoFactorEnabled
											? "text-primary"
											: "text-muted-foreground/30"
									}`}
								/>
							</TooltipTrigger>
							<TooltipContent>
								2FA: {row.original.twoFactorEnabled ? "Enabled" : "Disabled"}
							</TooltipContent>
						</Tooltip>
					</div>
				</TooltipProvider>
			),
		},
		{
			accessorKey: "expenseCount",
			header: () => <div className="text-right">Expenses</div>,
			enableSorting: true,
			size: 100,
			cell: ({ row }) => (
				<div className="text-right font-medium">
					{row.original.expenseCount}
				</div>
			),
		},
		{
			accessorKey: "createdAt",
			header: () => <div className="text-right">Joined</div>,
			enableSorting: true,
			size: 130,
			sortingFn: "datetime",
			cell: ({ row }) => (
				<div className="text-right text-muted-foreground text-sm">
					{format(new Date(row.original.createdAt), "MMM d, yyyy")}
				</div>
			),
		},
		{
			id: "actions",
			header: () => null,
			enableSorting: false,
			enableHiding: false,
			size: 48,
			cell: ({ row }) => {
				const user = row.original;
				return (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								className="h-7 w-7 md:opacity-0 transition-opacity md:group-hover:opacity-100"
								size="icon"
								variant="ghost"
							>
								<MoreHorizontal className="h-4 w-4" />
								<span className="sr-only">Actions</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-52">
							{user.id !== currentUserId && (
								<>
									<DropdownMenuItem
										onClick={() =>
											callbacks.onResetPassword(user.id, user.username)
										}
									>
										<RefreshCw className="mr-2 h-4 w-4" />
										Reset Password
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() => callbacks.onCopyResetLink(user.id)}
									>
										<Link className="mr-2 h-4 w-4" />
										Copy Reset Link
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() =>
											callbacks.onToggleUserStatus(
												user.id,
												user.username,
												user.isActive,
											)
										}
									>
										{user.isActive ? (
											<>
												<Lock className="mr-2 h-4 w-4" />
												Disable User
											</>
										) : (
											<>
												<LockOpen className="mr-2 h-4 w-4" />
												Enable User
											</>
										)}
									</DropdownMenuItem>
								</>
							)}
							{user.emailVerified ? (
								<DropdownMenuItem
									onClick={() =>
										callbacks.onMarkEmailVerified(
											user.id,
											user.username,
											false,
										)
									}
								>
									<MailWarning className="mr-2 h-4 w-4" />
									Mark Email Unverified
								</DropdownMenuItem>
							) : (
								<DropdownMenuItem
									onClick={() =>
										callbacks.onMarkEmailVerified(
											user.id,
											user.username,
											true,
										)
									}
								>
									<MailCheck className="mr-2 h-4 w-4" />
									Mark Email Verified
								</DropdownMenuItem>
							)}
							{callbacks.onSetAiAccess && user.id !== currentUserId && (
								<>
									<DropdownMenuSeparator />
									{user.externalAiAllowed === true ? (
										<DropdownMenuItem
											onClick={() =>
												callbacks.onSetAiAccess!(user.id, null)
											}
										>
											<Bot className="mr-2 h-4 w-4 opacity-50" />
											Revoke External AI Access
										</DropdownMenuItem>
									) : (
										<DropdownMenuItem
											onClick={() =>
												callbacks.onSetAiAccess!(user.id, true)
											}
										>
											<Bot className="mr-2 h-4 w-4" />
											Allow External AI Access
										</DropdownMenuItem>
									)}
								</>
							)}
							{user.id !== currentUserId && (
								<>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										onClick={() =>
											callbacks.onDeleteUser(user.id, user.username)
										}
										variant="destructive"
									>
										<Trash2 className="mr-2 h-4 w-4" />
										Delete User
									</DropdownMenuItem>
								</>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				);
			},
		},
	];
}
