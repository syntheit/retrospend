import { Redirect, router, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { projectHref } from "@/layout/detailRoutes";
import { showAlert } from "@/ui/alert";
import { EmptyState } from "@/ui/EmptyState";
import { Screen } from "@/ui/Screen";
import { SkeletonRows } from "@/ui/Skeleton";
import { JoinFlow } from "./JoinFlow";
import type { SharedFailure } from "./useSharedAccess";
import { useSharedAccess } from "./useSharedAccess";
import { SharedView } from "./SharedView";

/** Whether the signed-in account already has a seat in the project. */
function useIsMember(id: string): "checking" | "member" | "other" {
	const { state, api } = useSession();
	const [result, setResult] = useState<"checking" | "member" | "other">(
		"checking",
	);
	const signedIn = state.status === "signedIn" && api !== null;
	useEffect(() => {
		if (state.status === "loading") return;
		if (!signedIn || !api) {
			setResult("other");
			return;
		}
		let live = true;
		api.projects
			.get({ id })
			.then((page) => live && setResult(page.myRole ? "member" : "other"))
			.catch(() => live && setResult("other"));
		return () => {
			live = false;
		};
	}, [api, id, signedIn, state.status]);
	return result;
}

function Failure({ reason }: { reason: SharedFailure }) {
	const t = useTranslations("mobile.projects.shared");
	return (
		<Screen>
			<EmptyState
				detail={t(`failed.${reason}.hint`)}
				title={t(`failed.${reason}.title`)}
			/>
		</Screen>
	);
}

function Gateway({
	id,
	invite,
	resume,
	server,
	name,
}: {
	id: string;
	invite: string | null;
	resume: string | null;
	server: string | null;
	name?: string;
}) {
	const tc = useTranslations("mobile.common");
	const t = useTranslations("mobile.projects.shared");
	const { access, baseUrl, open, forget } = useSharedAccess({
		projectId: id,
		invite,
		resume,
		server,
	});
	const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));

	if (access.status === "loading" || !baseUrl) {
		return access.status === "failed" ? (
			<Failure reason={access.reason} />
		) : (
			<Screen>
				<SkeletonRows />
			</Screen>
		);
	}
	if (access.status === "failed") return <Failure reason={access.reason} />;
	if (access.status === "join") {
		return (
			<JoinFlow
				baseUrl={baseUrl}
				info={access.info}
				linkId={access.linkId}
				onGuest={(record) => open("guest", record)}
				onMember={() => router.replace(projectHref(id, false))}
				projectId={id}
			/>
		);
	}
	return (
		<SharedView
			baseUrl={baseUrl}
			mode={access.mode}
			name={name}
			onExpired={() => {
				void forget();
				open("public", null);
			}}
			onForget={() =>
				showAlert(t("forgetTitle"), undefined, [
					{ text: tc("cancel"), style: "cancel" },
					{
						text: t("forgetConfirm"),
						style: "destructive",
						onPress: () => {
							void forget().then(leave);
						},
					},
				])
			}
			projectId={id}
			record={access.record}
		/>
	);
}

/**
 * The page of a project you have no seat in, reached by a link: the join
 * step for an invite, then the read-only page of a guest, a viewer link or
 * the public. A project you are already in opens as itself. It sits outside
 * the signed-in tabs, so a guest with no account and no connection reaches it.
 */
export function SharedScreen({
	id,
	invite,
	resume,
	server,
	name,
}: {
	id: string;
	invite: string | null;
	resume: string | null;
	server: string | null;
	name?: string;
}) {
	const member = useIsMember(id);
	return (
		<>
			<Stack.Screen
				options={{
					headerShown: true,
					headerShadowVisible: false,
					headerLargeTitle: false,
					title: name ?? "",
				}}
			/>
			{member === "checking" ? (
				<Screen>
					<SkeletonRows />
				</Screen>
			) : member === "member" ? (
				<Redirect href={projectHref(id, false)} />
			) : (
				<Gateway
					id={id}
					invite={invite}
					name={name}
					resume={resume}
					server={server}
				/>
			)}
		</>
	);
}
