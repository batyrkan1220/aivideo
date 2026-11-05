import "server-only";

/*
  Videos longer than Kling allows are rejected in the browser and never stored.
  The server does not download a template video to cut it — that loaded the whole
  file into the 512 MB Render instance and the process was killed.
*/

/** Always null: trimming no longer runs on the web service. */
export async function trimTemplateIfTooLong(_templateId: string, _durationSec: number | null): Promise<string | null> {
  return null;
}
