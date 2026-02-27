"use client";

import {
	IconCircleCheck,
	IconCircleX,
	IconDotsVertical,
	IconLink,
	IconLock,
	IconLockOpen,
	IconMailCheck,
	IconMailExclamation,
	IconRefresh,
	IconTrash,
} from "@tabler/icons-react";
import { format } from "date-fns";
import { Landmark, PieChart, Repeat } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Skeleton } from "~/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { api } from "~/trpc/react";

interface User {
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
}

interface UsersTableProps {
	users: User[];
	isLoading: boolean;
	currentUserId?: string;
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
}

export function UsersTable({
	users,
	isLoading,
	currentUserId,
	onResetPassword,
	onToggleUserStatus,
	onMarkEmailVerified,
	onDeleteUser,
}: UsersTableProps) {
	const generateResetLinkMutation =
		api.admin.generatePasswordResetLink.useMutation({
			onSuccess: (data) => {
				navigator.clipboard.writeText(data.resetUrl);
				toast.success("Reset link copied to clipboard");
			},
			onError: (error) => {
				toast.error(error.message || "Failed to generate link");
			},
		});

	if (isLoading) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Users</CardTitle>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Username</TableHead>
								<TableHead>Email</TableHead>
								<TableHead>Role</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Features</TableHead>
								<TableHead className="text-right">Expenses</TableHead>
								<TableHead className="text-right">Joined</TableHead>
								<TableHead className="w-[50px]"></TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{Array.from({ length: 5 }).map((_, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: Skeleton items are identical and order won't change
								<TableRow key={i}>
									<TableCell>
										<Skeleton className="h-5 w-[100px]" />
									</TableCell>
									<TableCell>
										<Skeleton className="h-5 w-[180px]" />
									</TableCell>
									<TableCell>
										<Skeleton className="h-5 w-[60px]" />
									</TableCell>
									<TableCell>
										<Skeleton className="h-5 w-[60px]" />
									</TableCell>
									<TableCell>
										<Skeleton className="h-5 w-[80px]" />
									</TableCell>
									<TableCell className="text-right">
										<Skeleton className="ml-auto h-5 w-[30px]" />
									</TableCell>
									<TableCell className="text-right">
										<Skeleton className="ml-auto h-5 w-[80px]" />
									</TableCell>
									<TableCell>
										<Skeleton className="h-8 w-8 rounded-full" />
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Users ({users.length})</CardTitle>
			</CardHeader>
			<CardContent>
				{users.length === 0 ? (
					<div className="py-8 text-center">
						<p className="text-muted-foreground">No users found.</p>
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Username</TableHead>
								<TableHead>Email</TableHead>
								<TableHead>Role</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Features</TableHead>
								<TableHead className="text-right">Expenses</TableHead>
								<TableHead className="text-right">Joined</TableHead>
								<TableHead className="w-[50px]"></TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{users.map((user) => {
								const daysSinceLastExpense = user.lastExpenseDate
									? Math.floor(
											(Date.now() - new Date(user.lastExpenseDate).getTime()) /
												(1000 * 60 * 60 * 24),
										)
									: Number.POSITIVE_INFINITY;

								const isDormant = daysSinceLastExpense > 14;

								return (
									<TableRow key={user.id}>
										<TableCell className="font-medium">
											@{user.username}
										</TableCell>
										<TableCell className="text-muted-foreground">
											<div className="flex items-center gap-1.5">
												{user.email}
												<TooltipProvider>
													<Tooltip>
														<TooltipTrigger asChild>
															{user.emailVerified ? (
																<IconCircleCheck className="h-3.5 w-3.5 text-green-500" />
															) : (
																<IconCircleX className="h-3.5 w-3.5 text-muted-foreground/50" />
															)}
														</TooltipTrigger>
														<TooltipContent>
															{user.emailVerified
																? "Email verified"
																: "Email not verified"}
														</TooltipContent>
													</Tooltip>
												</TooltipProvider>
											</div>
										</TableCell>
										<TableCell>
											<Badge
												variant={
													user.role === "ADMIN" ? "default" : "secondary"
												}
											>
												{user.role}
											</Badge>
										</TableCell>
										<TableCell>
											{!user.isActive ? (
												<Badge variant="destructive">Disabled</Badge>
											) : isDormant ? (
												<Badge className="border-transparent bg-yellow-500/10 text-yellow-500 shadow-none hover:bg-yellow-500/20">
													Dormant
												</Badge>
											) : (
												<Badge className="border-transparent bg-green-500/10 text-green-500 shadow-none hover:bg-green-500/20">
													Active
												</Badge>
											)}
										</TableCell>
										<TableCell>
											<TooltipProvider>
												<div className="flex items-center gap-2">
													<Tooltip>
														<TooltipTrigger asChild>
															<PieChart
																className={`h-4 w-4 ${
																	user.hasBudget
																		? "text-primary"
																		: "text-muted-foreground/30"
																}`}
															/>
														</TooltipTrigger>
														<TooltipContent>
															Budget: {user.hasBudget ? "Active" : "Unused"}
														</TooltipContent>
													</Tooltip>
													<Tooltip>
														<TooltipTrigger asChild>
															<Repeat
																className={`h-4 w-4 ${
																	user.hasRecurring
																		? "text-primary"
																		: "text-muted-foreground/30"
																}`}
															/>
														</TooltipTrigger>
														<TooltipContent>
															Recurring:{" "}
															{user.hasRecurring ? "Active" : "Unused"}
														</TooltipContent>
													</Tooltip>
													<Tooltip>
														<TooltipTrigger asChild>
															<Landmark
																className={`h-4 w-4 ${
																	user.hasWealth
																		? "text-primary"
																		: "text-muted-foreground/30"
																}`}
															/>
														</TooltipTrigger>
														<TooltipContent>
															Wealth: {user.hasWealth ? "Active" : "Unused"}
														</TooltipContent>
													</Tooltip>
												</div>
											</TooltipProvider>
										</TableCell>
										<TableCell className="text-right font-medium">
											{user.expenseCount}
										</TableCell>
										<TableCell className="text-right text-muted-foreground text-sm">
											{format(new Date(user.createdAt), "MMM d, yyyy")}
										</TableCell>
										<TableCell>
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button
														className="h-8 w-8"
														size="icon"
														variant="ghost"
													>
														<IconDotsVertical className="h-4 w-4" />
														<span className="sr-only">Open menu</span>
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													{user.id !== currentUserId && (
														<>
															<DropdownMenuItem
																onClick={() =>
																	onResetPassword(user.id, user.username)
																}
															>
																<IconRefresh className="mr-2 h-4 w-4" />
																Reset Password
															</DropdownMenuItem>
															<DropdownMenuItem
																onClick={() =>
																	generateResetLinkMutation.mutate({
																		userId: user.id,
																	})
																}
															>
																<IconLink className="mr-2 h-4 w-4" />
																Copy Reset Link
															</DropdownMenuItem>
															<DropdownMenuItem
																onClick={() =>
																	onToggleUserStatus(
																		user.id,
																		user.username,
																		user.isActive,
																	)
																}
															>
																{user.isActive ? (
																	<>
																		<IconLock className="mr-2 h-4 w-4" />
																		Disable User
																	</>
																) : (
																	<>
																		<IconLockOpen className="mr-2 h-4 w-4" />
																		Enable User
																	</>
																)}
															</DropdownMenuItem>
														</>
													)}
													{user.emailVerified ? (
														<DropdownMenuItem
															onClick={() =>
																onMarkEmailVerified(
																	user.id,
																	user.username,
																	false,
																)
															}
														>
															<IconMailExclamation className="mr-2 h-4 w-4" />
															Mark Email Unverified
														</DropdownMenuItem>
													) : (
														<DropdownMenuItem
															onClick={() =>
																onMarkEmailVerified(
																	user.id,
																	user.username,
																	true,
																)
															}
														>
															<IconMailCheck className="mr-2 h-4 w-4" />
															Mark Email Verified
														</DropdownMenuItem>
													)}
													{user.id !== currentUserId && (
														<>
															<DropdownMenuSeparator />
															<DropdownMenuItem
																onClick={() =>
																	onDeleteUser(user.id, user.username)
																}
																variant="destructive"
															>
																<IconTrash className="mr-2 h-4 w-4" />
																Delete User
															</DropdownMenuItem>
														</>
													)}
												</DropdownMenuContent>
											</DropdownMenu>
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
