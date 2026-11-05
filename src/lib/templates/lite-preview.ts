import "server-only";

/*
  Template videos live in Supabase Storage. The web service used to download each one and
  run ffmpeg for a lighter card copy. On the 512 MB Render instance that killed the process.
  Cards play the Supabase file directly (preview_lite_path = preview_video_path).
*/

/** Kept so older call sites stay safe. Does not download or transcode. */
export function queueLitePreview(_templateId: string) {}

/** Kept so a startup import cannot pull videos onto the server. */
export async function backfillLitePreviews() {
  return 0;
}
