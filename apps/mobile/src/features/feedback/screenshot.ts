import { FEEDBACK_SCREENSHOT_MAX_BYTES } from "@retrospend/api-contract/feedback-client";
import * as ImagePicker from "expo-image-picker";

export type ScreenshotPick =
	| { status: "picked"; uri: string }
	| { status: "canceled" }
	| { status: "tooLarge" };

interface ViewShot {
	captureScreen(options: {
		format: "jpg";
		quality: number;
		result: "tmpfile";
	}): Promise<string>;
}

/**
 * A picture of the screen the person was on, as a temporary JPEG, or null
 * when the system cannot take one. The module loads only when asked, so the
 * app starts without it.
 */
export async function captureScreen(): Promise<string | null> {
	try {
		const shot = require("react-native-view-shot") as ViewShot;
		return await shot.captureScreen({
			format: "jpg",
			quality: 0.7,
			result: "tmpfile",
		});
	} catch {
		return null;
	}
}

/**
 * An image from the library. Not cropped, and re-encoded as JPEG by the
 * picker, so a HEIC photo still has a type the server accepts. Over the
 * server's limit (5 MB) is refused here, so nothing is sent.
 */
export async function pickScreenshot(): Promise<ScreenshotPick> {
	const result = await ImagePicker.launchImageLibraryAsync({
		mediaTypes: ["images"],
		allowsEditing: false,
		quality: 0.8,
	});
	const asset = result.canceled ? null : result.assets[0];
	if (!asset) return { status: "canceled" };
	if ((asset.fileSize ?? 0) > FEEDBACK_SCREENSHOT_MAX_BYTES)
		return { status: "tooLarge" };
	return { status: "picked", uri: asset.uri };
}

/**
 * The file as a Blob, which API v1 sends as multipart. The client's type says
 * File (the web's); the server reads the same bytes either way. Null when it
 * is over the limit.
 */
export async function readScreenshot(uri: string): Promise<File | null> {
	const blob = await (await fetch(uri)).blob();
	return blob.size > FEEDBACK_SCREENSHOT_MAX_BYTES
		? null
		: (blob as unknown as File);
}
