"use client";

import {
	IconDotsVertical,
	IconLock,
	IconLockOpen,
	IconRefresh,
	IconTrash,
} from "@tabler/icons-react";
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

interface User {
	id: string;
	username: string;
	email: string;
	role: "ADMIN" | "USER";
	isActive: boolean;
	expenseCount: number;
	inviteCodesCount: number;
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
	onDeleteUser: (userId: string, username: string) => void;
}

export function UsersTable({
	users,
	isLoading,
	currentUserId,
	onResetPassword,
	onToggleUserStatus,
	onDeleteUser,
}: UsersTableProps) {
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
								<TableHead className="text-right">Expenses</TableHead>
								<TableHead className="text-right">Invite Codes</TableHead>
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
									<TableCell className="text-right">
										<Skeleton className="ml-auto h-5 w-[30px]" />
									</TableCell>
									<TableCell className="text-right">
										<Skeleton className="ml-auto h-5 w-[30px]" />
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
								<TableHead className="text-right">Expenses</TableHead>
								<TableHead className="text-right">Invite Codes</TableHead>
								<TableHead className="w-[50px]"></TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{users.map((user) => (
								<TableRow key={user.id}>
									<TableCell className="font-medium">
										@{user.username}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{user.email}
									</TableCell>
									<TableCell>
										<Badge
											variant={user.role === "ADMIN" ? "default" : "secondary"}
										>
											{user.role}
										</Badge>
									</TableCell>
									<TableCell>
										<Badge variant={user.isActive ? "default" : "destructive"}>
											{user.isActive ? "Active" : "Disabled"}
										</Badge>
									</TableCell>
									<TableCell className="text-right font-medium">
										{user.expenseCount}
									</TableCell>
									<TableCell className="text-right font-medium">
										{user.inviteCodesCount}
									</TableCell>
									<TableCell>
										{user.id !== currentUserId && (
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
													<DropdownMenuSeparator />
													<DropdownMenuItem
														onClick={() => onDeleteUser(user.id, user.username)}
														variant="destructive"
													>
														<IconTrash className="mr-2 h-4 w-4" />
														Delete User
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
