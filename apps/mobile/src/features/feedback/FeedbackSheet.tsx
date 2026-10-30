import type { ErrorReportInput } from "@retrospend/api-contract";
import { type ReactNode, useEffect, useState } from "react";
import {
	Image,
	Platform,
	ScrollView,
	useWindowDimensions,
	View,
} from "react-native";
import { useLocale, useTranslations } from "use-intl";
import { useServerBaseUrl } from "@/auth/server-connection";
import { useSession } from "@/auth/session";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { ListGroup, ListRow } from "@/ui/List";
import { Segmented } from "@/ui/Segmented";
import { Sheet, useSheetBodySize } from "@/ui/Sheet";
import { SwitchRow } from "@/ui/SwitchRow";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";
import { toReport } from "./errorLog";
import {
	buildFeedback,
	collectDiagnostics,
	DIAGNOSTIC_ERRORS,
	type DiagnosticRow,
	diagnosticRows,
	type FeedbackCategory,
} from "./payload";
import { appFacts, getErrorLog } from "./runtime";
import { screenKey } from "./ScreenTracker";
import { discardTempImage, pickScreenshot, readScreenshot } from "./screenshot";
import { sendFeedback } from "./sendFeedback";

const CATEGORIES: FeedbackCategory[] = ["bug", "idea", "other"];
/** The server's limit for a message. */
const MESSAGE_MAX = 5000;

/** A list group inside the sheet: it takes back the sheet's side padding and sits on its edge. */
function Group({ children }: { children: ReactNode }) {
	const { size } = useTheme();
	return (
		<View style={{ marginHorizontal: -size.gutter.phone }}>
			<ListGroup>{children}</ListGroup>
		</View>
	);
}

function Heading({ children }: { children: string }) {
	return (
		<Text accessibilityRole="header" tone="fg3" variant="meta">
			{children}
		</Text>
	);
}

/** One line of the preview: what, and its value at the end. */
function PreviewRow({ title, value }: { title: string; value: string }) {
	return (
		<ListRow
			accessibilityLabel={`${title}, ${value}`}
			end={
				<Text numberOfLines={1} tone="fg2">
					{value}
				</Text>
			}
			title={title}
		/>
	);
}

/**
 * Send feedback: a category, a message, an optional screenshot (this screen
 * as it was, or an image from the library) and optional diagnostics. Under
 * the form, a preview lists exactly what will be sent, and says what never
 * is. It goes to the admins of the server this app is connected to, and
 * nowhere else.
 */
export function FeedbackSheet({
	visible,
	onClose,
	captured,
	screen,
}: {
	visible: boolean;
	onClose: () => void;
	/** A picture of the screen taken before the sheet opened, if the system gave one. */
	captured: string | null;
	/** The route the person was on. */
	screen: string | undefined;
}) {
	const t = useTranslations("mobile.feedback");
	const tc = useTranslations("mobile.common");
	const { api } = useSession();
	const toast = useToast();
	const locale = useLocale();
	const baseUrl = useServerBaseUrl();
	const window = useWindowDimensions();
	const { radius, size, space } = useTheme();
	const body = useSheetBodySize({ footer: true });
	const [category, setCategory] = useState<FeedbackCategory>("bug");
	const [message, setMessage] = useState("");
	const [shot, setShot] = useState<string | null>(null);
	const [withDiagnostics, setWithDiagnostics] = useState(false);
	const [serverVersion, setServerVersion] = useState<string | undefined>();
	const [recent, setRecent] = useState<ErrorReportInput[]>([]);
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);

	// Each opening starts empty and reads the two things diagnostics need.
	useEffect(() => {
		if (!visible) return;
		let cancelled = false;
		setCategory("bug");
		setMessage("");
		setShot(null);
		setWithDiagnostics(false);
		setProblem(null);
		setServerVersion(undefined);
		setRecent([]);
		getErrorLog()
			.recent(DIAGNOSTIC_ERRORS)
			.then((entries) => !cancelled && setRecent(entries.map(toReport)))
			.catch(() => undefined);
		api?.platform
			.serverInfo()
			.then((info) => !cancelled && setServerVersion(info.version))
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [visible, api]);

	const diagnostics = withDiagnostics
		? collectDiagnostics({
				facts: appFacts(),
				locale,
				serverVersion,
				recentErrors: recent,
			})
		: null;
	const rows: DiagnosticRow[] = diagnostics ? diagnosticRows(diagnostics) : [];
	const host = baseUrl ? new URL(baseUrl).host : "";
	const text = message.trim();

	async function pick() {
		const picked = await pickScreenshot();
		if (picked.status === "picked") {
			drop(shot);
			setShot(picked.uri);
		}
		if (picked.status === "tooLarge") setProblem(t("tooLarge"));
	}

	async function send() {
		if (!api || busy || text === "") return;
		setBusy(true);
		setProblem(null);
		try {
			const file = shot ? await readScreenshot(shot) : null;
			if (shot && !file) {
				setProblem(t("tooLarge"));
				return;
			}
			const result = await sendFeedback(
				api,
				buildFeedback({
					message,
					category,
					screen,
					diagnostics,
					viewport: window,
				}),
				file,
			);
			if (
				result.status === "sent" ||
				result.status === "sentWithoutScreenshot"
			) {
				toast.show({
					message: result.status === "sent" ? t("sent") : t("sentNoScreenshot"),
				});
				close();
			} else {
				setProblem(result.status === "limit" ? t("limit") : t("failed"));
			}
		} catch {
			setProblem(t("failed"));
		} finally {
			setBusy(false);
		}
	}

	/** The capture is the provider's to delete; a picked copy is this sheet's. */
	function drop(uri: string | null) {
		if (uri && uri !== captured) discardTempImage(uri);
	}
	function close() {
		drop(shot);
		onClose();
	}
	const thumb = size.avatar.xl;
	return (
		<Sheet
			detents={["large"]}
			footer={
				<>
					{Platform.OS === "android" ? (
						<Button label={tc("cancel")} onPress={close} variant="text" />
					) : null}
					<Button
						disabled={busy || text === ""}
						label={busy ? t("sending") : t("send")}
						onPress={() => void send()}
					/>
				</>
			}
			onClose={close}
			title={t("title")}
			visible={visible}
		>
			<ScrollView
				contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
				keyboardShouldPersistTaps="handled"
				style={{ height: body.height }}
			>
				<Segmented
					accessibilityLabel={t("category")}
					onChange={setCategory}
					options={CATEGORIES.map((value) => ({
						value,
						label: t(`categories.${value}`),
					}))}
					stretch
					value={category}
				/>
				<TextField
					autoCapitalize="sentences"
					label={t("message")}
					maxLength={MESSAGE_MAX}
					multiline
					onChangeText={setMessage}
					placeholder={t("messagePlaceholder")}
					value={message}
				/>
				<View style={{ gap: space[2] }}>
					<Heading>{t("screenshot")}</Heading>
					<Group>
						{shot ? (
							<ListRow
								end={
									<Button
										label={t("remove")}
										onPress={() => {
											drop(shot);
											setShot(null);
										}}
										size="small"
										variant="outlined"
									/>
								}
								lead={
									<Image
										accessibilityIgnoresInvertColors
										source={{ uri: shot }}
										style={{
											width: thumb,
											height: thumb,
											borderRadius: radius.ctl,
										}}
									/>
								}
								title={t("attached")}
							/>
						) : (
							<>
								{captured ? (
									<ListRow
										onPress={() => setShot(captured)}
										title={t("attachScreen")}
									/>
								) : null}
								<ListRow onPress={() => void pick()} title={t("chooseImage")} />
							</>
						)}
					</Group>
				</View>
				<SwitchRow
					detail={t("diagnosticsDetail")}
					label={t("diagnostics")}
					onChange={setWithDiagnostics}
					value={withDiagnostics}
				/>
				<View style={{ gap: space[2] }}>
					<Heading>{t("preview.title")}</Heading>
					<Group>
						<PreviewRow
							title={t("preview.category")}
							value={t(`categories.${category}`)}
						/>
						<PreviewRow
							title={t("preview.message")}
							value={t("preview.characters", { count: text.length })}
						/>
						<PreviewRow
							title={t("preview.screen")}
							value={t(`screens.${screenKey(screen)}`)}
						/>
						<PreviewRow
							title={t("preview.screenshot")}
							value={shot ? t("preview.attached") : t("preview.none")}
						/>
						{rows.length === 0 ? (
							<PreviewRow
								title={t("preview.diagnostics")}
								value={t("preview.notIncluded")}
							/>
						) : (
							rows.map((row) => (
								<PreviewRow
									key={row.key}
									title={t(`diagnosticRows.${row.key}`)}
									value={row.value}
								/>
							))
						)}
					</Group>
					{shot ? (
						// A picture shows whatever was on screen, amounts included, so
						// the line that says amounts are never sent must not stand.
						<Text tone="attention" variant="small">
							{t("preview.screenshotWarning", { host })}
						</Text>
					) : (
						<>
							<Text tone="fg3" variant="small">
								{t("preview.never")}
							</Text>
							{host ? (
								<Text tone="fg3" variant="small">
									{t("preview.goesTo", { host })}
								</Text>
							) : null}
						</>
					)}
				</View>
				{problem ? (
					<Text accessibilityRole="alert" tone="danger">
						{problem}
					</Text>
				) : null}
			</ScrollView>
		</Sheet>
	);
}
