/**
 * A fetched Blob where the API client wants a File. API v1 sends it as
 * multipart; the client's type says File (the web's) and the server reads the
 * same bytes either way.
 */
export function asFile(blob: Blob): File {
	return blob as unknown as File;
}
