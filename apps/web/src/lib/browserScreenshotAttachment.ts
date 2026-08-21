import type { BrowserCaptureScreenshotResult } from "@synara/contracts";

import type { ComposerImageAttachment } from "../composerDraftStore";
import { prepareComposerImageAttachmentsFromFiles } from "./composerSend";

export function screenshotAttachmentName(input: BrowserCaptureScreenshotResult): string {
  return input.name.trim().length > 0 ? input.name : `browser-${Date.now()}.png`;
}

function fileFromBrowserScreenshot(screenshot: BrowserCaptureScreenshotResult): File {
  if (screenshot.bytes.byteLength === 0) {
    throw new Error("Browser screenshot is empty.");
  }
  const bytes = new Uint8Array(screenshot.bytes);
  return new File([bytes], screenshotAttachmentName(screenshot), {
    type: screenshot.mimeType,
  });
}

export async function prepareComposerImageFromBrowserScreenshot(
  screenshot: BrowserCaptureScreenshotResult,
): Promise<ComposerImageAttachment> {
  const file = fileFromBrowserScreenshot(screenshot);
  const result = await prepareComposerImageAttachmentsFromFiles({
    files: [file],
    existingAttachmentCount: 0,
  });
  const image = result.images[0];
  if (!image) {
    throw new Error(result.error ?? "Browser screenshot could not be prepared.");
  }
  return image;
}
