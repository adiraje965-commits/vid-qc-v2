## Diagnosis

Deep Review is failing before Gemini sees the video. The current `deep-video-review` resolver falls back to Firecrawl, but it only scans `rawHtml` plus links for literal `.mp4` / `.m3u8` URLs. The deployed logs show Firecrawl was reached, but no direct media URL was found.

The transcript function has a stronger resolver than Deep Review: it keeps Firecrawl `extraLinks`, decodes more JSON/script patterns, scans base64-hidden URLs, and uses a `filterLinksForMedia` fallback. Deep Review is missing some of those pieces, so it can fail even when Firecrawl successfully fetched the page.

## Plan

1. **Bring Deep Review resolver to parity with the transcript resolver**
   - Add resolver logging so failures show exactly whether Firecrawl returned HTML/links and where extraction stopped.
   - Add `extraLinks` to the Firecrawl page result instead of flattening links into HTML only.
   - Add the missing extraction passes from `transcribe-video`: JSON-LD, `JSON.parse("...")` blobs, base64 URL decoding, Firecrawl link filtering, and `application/octet-stream` media detection.

2. **Persist resolved media metadata before Gemini processing**
   - When Deep Review resolves the actual media URL, update the task with `media_url` and `media_kind`.
   - This lets the transcript/live UI know the true stream/file source and makes future debugging visible on the task.

3. **Improve failed-task state**
   - On Deep Review failure, mark the task as `failed` and set `transcript_status` to `failed` instead of leaving it as completed with only an error message.
   - Keep the current friendly fallback message for unsupported DRM/HLS cases.

4. **Deploy and verify against the current failing task**
   - Deploy `deep-video-review`.
   - Invoke it on task `d92c7f4f-3cf0-45e7-89a8-21b39da10838` with its Bajaj kapsule URL.
   - Check function logs and the task row to confirm either:
     - the real media URL is resolved and review starts, or
     - the remaining blocker is clearly identified as DRM/no exposed media source rather than a generic fetch failure.