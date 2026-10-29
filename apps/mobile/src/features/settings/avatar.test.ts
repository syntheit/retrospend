import { AVATAR_MAX_BYTES } from "@retrospend/api-contract";
import * as ImagePicker from "expo-image-picker";
import { pickAvatar, readAvatar } from "./avatar";

// The contract's runtime is ESM; only the limit is needed here.
jest.mock("@retrospend/api-contract", () => ({
	AVATAR_MAX_BYTES: 5 * 1024 * 1024,
}));
jest.mock("expo-image-picker", () => ({
	requestCameraPermissionsAsync: jest.fn(),
	launchCameraAsync: jest.fn(),
	launchImageLibraryAsync: jest.fn(),
}));

const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;

function picked(fileSize?: number) {
	return {
		canceled: false,
		assets: [{ uri: "file:///cache/crop.jpg", fileSize }],
	} as unknown as ImagePicker.ImagePickerResult;
}

describe("pickAvatar", () => {
	beforeEach(() => jest.resetAllMocks());

	it("crops square from the library without asking for a permission", async () => {
		picker.launchImageLibraryAsync.mockResolvedValue(picked(120_000));
		expect(await pickAvatar("library")).toEqual({
			status: "picked",
			uri: "file:///cache/crop.jpg",
		});
		expect(picker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
		expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(
			expect.objectContaining({ allowsEditing: true, aspect: [1, 1] }),
		);
	});

	it("asks for the camera first and stops when it is refused", async () => {
		picker.requestCameraPermissionsAsync.mockResolvedValue({
			granted: false,
		} as ImagePicker.PermissionResponse);
		expect(await pickAvatar("camera")).toEqual({ status: "denied" });
		expect(picker.launchCameraAsync).not.toHaveBeenCalled();
	});

	it("opens the camera once allowed", async () => {
		picker.requestCameraPermissionsAsync.mockResolvedValue({
			granted: true,
		} as ImagePicker.PermissionResponse);
		picker.launchCameraAsync.mockResolvedValue(picked());
		expect((await pickAvatar("camera")).status).toBe("picked");
	});

	it("reports a canceled pick", async () => {
		picker.launchImageLibraryAsync.mockResolvedValue({
			canceled: true,
			assets: null,
		});
		expect(await pickAvatar("library")).toEqual({ status: "canceled" });
	});

	it("refuses a file over the server's limit before anything is sent", async () => {
		picker.launchImageLibraryAsync.mockResolvedValue(
			picked(AVATAR_MAX_BYTES + 1),
		);
		expect(await pickAvatar("library")).toEqual({ status: "tooLarge" });
	});
});

describe("readAvatar", () => {
	it("reads the picked file as a blob for the multipart upload", async () => {
		const blob = new Blob(["x"], { type: "image/jpeg" });
		const fetchMock = jest
			.spyOn(globalThis, "fetch")
			.mockResolvedValue({ blob: async () => blob } as Response);
		expect(await readAvatar("file:///cache/crop.jpg")).toBe(blob);
		expect(fetchMock).toHaveBeenCalledWith("file:///cache/crop.jpg");
		fetchMock.mockRestore();
	});
});
