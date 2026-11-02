import { AVATAR_MAX_BYTES } from "@retrospend/api-contract";
import * as ImagePicker from "expo-image-picker";
import { asFile } from "@/lib/asFile";

export type AvatarSource = "camera" | "library";

export type AvatarPick =
	| { status: "picked"; uri: string }
	| { status: "canceled" }
	| { status: "denied" }
	| { status: "tooLarge" };

/**
 * Asks for a photo and crops it square (the picker's own crop screen). A
 * JPEG comes back, because the picker re-encodes when it crops, so phones
 * that shoot HEIC still send a type the server accepts (JPEG, PNG, WebP,
 * GIF). The camera asks for its permission first; the library needs none.
 * Over the server's limit (5 MB) is refused here, so nothing is sent.
 */
export async function pickAvatar(source: AvatarSource): Promise<AvatarPick> {
	if (source === "camera") {
		const allowed = await ImagePicker.requestCameraPermissionsAsync();
		if (!allowed.granted) return { status: "denied" };
	}
	const options: ImagePicker.ImagePickerOptions = {
		mediaTypes: ["images"],
		allowsEditing: true,
		aspect: [1, 1],
		quality: 0.9,
	};
	const result =
		source === "camera"
			? await ImagePicker.launchCameraAsync(options)
			: await ImagePicker.launchImageLibraryAsync(options);
	const asset = result.canceled ? null : result.assets[0];
	if (!asset) return { status: "canceled" };
	if ((asset.fileSize ?? 0) > AVATAR_MAX_BYTES) return { status: "tooLarge" };
	return { status: "picked", uri: asset.uri };
}

/** The picked picture as a file for the multipart upload. */
export async function readAvatar(uri: string): Promise<File> {
	return asFile(await (await fetch(uri)).blob());
}
