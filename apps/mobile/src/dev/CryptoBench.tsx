import {
	type BenchReport,
	benchJson,
	benchRows,
	runCryptoBench,
} from "@retrospend/crypto";
import * as Clipboard from "expo-clipboard";
import * as Device from "expo-device";
import { useState } from "react";
import { Platform, View } from "react-native";
import { getPrimitives } from "@/crypto/native";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TopBar } from "@/ui/TopBar";

// The F4 benchmark screen: how long Argon2id and a bulk open take on this
// phone. Development only (flags.ts): app/crypto-bench.tsx requires this file
// only in a dev or gallery build, and scripts/check-release-bundle.sh greps
// for the name below. It seals synthetic records, no user data.

const frame = () =>
	new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export function CryptoBench() {
	const { space } = useTheme();
	const [step, setStep] = useState<string | null>(null);
	const [report, setReport] = useState<BenchReport | null>(null);
	const [failed, setFailed] = useState(false);

	const start = async () => {
		setReport(null);
		setFailed(false);
		try {
			const primitives = await getPrimitives();
			setReport(
				await runCryptoBench(primitives, {
					now: () => performance.now(),
					// Two frames, so the step label paints before the blocking work.
					pause: async () => {
						await frame();
						await frame();
					},
					onStep: setStep,
				}),
			);
		} catch {
			setFailed(true);
		} finally {
			setStep(null);
		}
	};
	const copy = () => {
		if (!report) return;
		const env = {
			device: Device.modelName ?? "unknown",
			os: `${Platform.OS} ${Platform.Version}`,
		};
		void Clipboard.setStringAsync(benchJson(env, report));
	};

	return (
		<>
			<TopBar
				account={{ key: "user:bench", name: "Daniel M", imageUri: null }}
				accountLabel="Account"
				title="Crypto benchmark"
			/>
			<Screen>
				<View style={{ flexDirection: "row", gap: space[2] }}>
					<Button
						label={step ? "Running" : "Run"}
						onPress={step ? undefined : start}
					/>
					<Button
						label="Copy results"
						onPress={report ? copy : undefined}
						variant="outlined"
					/>
				</View>
				{step ? (
					<Text tone="fg3" variant="small">
						{step}
					</Text>
				) : null}
				{failed ? (
					<Text tone="danger" variant="small">
						Run failed
					</Text>
				) : null}
				{report
					? benchRows(report).map((row) => (
							<View
								key={row.label}
								style={{
									flexDirection: "row",
									justifyContent: "space-between",
								}}
							>
								<Text tone="fg2">{row.label}</Text>
								<Text>{row.value}</Text>
							</View>
						))
					: null}
			</Screen>
		</>
	);
}

CryptoBench.displayName = "RetrospendCryptoBench";
