"use client";

import {
	type Icon,
	IconMailExclamation,
	IconSpeakerphone,
	IconTicket,
} from "@tabler/icons-react";
import type * as React from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "~/components/ui/sidebar";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";

export function NavSecondary({
	items,
	...props
}: {
	items: {
		title: string;
		url: string;
		icon: Icon;
	}[];
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
	const { data: settings } = api.settings.getGeneral.useQuery();
	const { data: session } = useSession();
	const { data: appFeatures } = api.auth.getAppFeatures.useQuery();

	const resendEmail = api.auth.resendVerificationEmail.useMutation({
		onSuccess: () => {
			toast.success("Verification email sent!");
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	return (
		<SidebarGroup {...props}>
			<SidebarGroupContent>
				<SidebarMenu>
					{appFeatures?.isEmailEnabled &&
						session?.user &&
						!session.user.emailVerified && (
							<SidebarMenuItem>
								<div className="mx-2 mb-2 flex flex-col gap-2 rounded-md border border-warning/20 bg-warning/10 p-3 text-warning shadow-sm">
									<div className="flex items-center gap-2">
										<IconMailExclamation className="size-5" />
										<span className="font-semibold text-sm">Verify Email</span>
									</div>
									<span className="text-xs">
										Please verify your email address to secure your account.
									</span>
									<Button
										variant="outline"
										size="sm"
										className="h-8 w-full border-warning/20 bg-warning/10 text-warning hover:bg-warning/20"
										onClick={(e) => {
											e.preventDefault();
											resendEmail.mutate();
										}}
										disabled={resendEmail.isPending}
									>
										{resendEmail.isPending ? "Sending..." : "Resend Email"}
									</Button>
								</div>
							</SidebarMenuItem>
						)}
					<SidebarMenuItem>
						<SidebarMenuButton
							asChild
							className="h-10 px-4 py-4 text-base [&>svg]:size-5"
						>
							<a
								href="https://forms.gle/LgLS7wSJGWSjQYEs7"
								rel="noopener noreferrer"
								target="_blank"
							>
								<IconSpeakerphone />
								<span>Feedback</span>
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
					{settings?.allowAllUsersToGenerateInvites && (
						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								className="h-10 px-4 py-4 text-base [&>svg]:size-5"
							>
								<a href="/app/invite-codes">
									<IconTicket />
									<span>Invite Codes</span>
								</a>
							</SidebarMenuButton>
						</SidebarMenuItem>
					)}
					{items.map((item) => (
						<SidebarMenuItem key={item.title}>
							<SidebarMenuButton
								asChild
								className="h-10 px-4 py-4 text-base [&>svg]:size-5"
							>
								<a href={item.url}>
									<item.icon />
									<span>{item.title}</span>
								</a>
							</SidebarMenuButton>
						</SidebarMenuItem>
					))}
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}
