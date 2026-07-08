import { expect, test } from "@playwright/test";
import { gotoFreshWorkspace, smokeUrl, submitPrompt } from "./support/dev-smoke";

// R3 / Slice B, pinned from the live-transcript failure: "after you send a message, it
// doesn't fast forward to the bottom... it doesn't automatically open when you say
// 'creating an artifact'." (docs/handoffs/streaming-canvas-artifact-ux-investigation-2026-07-08.md).
//
// Root cause (packages/chat-surface/src/vendor/amplify-chat/Conversation/ConversationContent.svelte):
// the scroll container's ResizeObserver watches the CONTAINER's own box, not its
// children -- appending text-delta content grows `scrollHeight` without changing the
// container's own bounding box, so the observer never fires during token streaming and
// `scrollToBottom()` is never called mid-stream. This is the acceptance bar Slice B
// ("follow while streaming" scroll mode) needs to satisfy; both cases are written now
// and fixme'd until that lands.
//
// No smoke scenario needed for text volume -- the default dev-smoke stream (no
// `smokeScenario` param) emits three text deltas ~75ms apart, enough to exercise
// mid-stream growth in a viewport short enough to overflow.

test.fixme(
  "stream-follows-bottom: transcript stays scrolled to bottom while a response streams in",
  async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 420 });
    await gotoFreshWorkspace(page, smokeUrl(null));

    // Build up enough prior messages that the transcript already overflows the
    // viewport before the streaming turn starts.
    for (let i = 0; i < 4; i += 1) {
      await submitPrompt(page, `filler message ${i} to build scroll height`);
      await page.waitForTimeout(600);
    }

    const scrollContainer = page.locator(".overflow-auto.flex-1");
    await submitPrompt(page, "one more streaming turn");
    // Mid-stream (the response is still being written token by token): the
    // container should already be pinned to (or actively catching up to) the
    // bottom, not left behind at its pre-send scroll position.
    await page.waitForTimeout(100);
    const midStream = await scrollContainer.evaluate((el) => ({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(midStream.scrollTop + midStream.clientHeight).toBeGreaterThanOrEqual(midStream.scrollHeight - 96);
  },
);

test.fixme(
  "stream-follows-bottom: scrolling up mid-stream stops auto-follow (Scroll to bottom affordance appears)",
  async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 420 });
    await gotoFreshWorkspace(page, smokeUrl(null));

    for (let i = 0; i < 4; i += 1) {
      await submitPrompt(page, `filler message ${i} to build scroll height`);
      await page.waitForTimeout(600);
    }

    const scrollContainer = page.locator(".overflow-auto.flex-1");
    await submitPrompt(page, "scroll away during this turn");
    await page.waitForTimeout(50);
    await scrollContainer.evaluate((el) => { el.scrollTop = 0; });
    await scrollContainer.dispatchEvent("scroll");

    // Once the user deliberately scrolls away mid-stream, follow-to-bottom should
    // stop and the "Scroll to bottom" affordance should appear -- today's
    // ConversationScrollButton already implements this reactively off `isAtBottom`,
    // so this half is closer to passing; it's grouped with the case above because
    // both assert the same "follow while streaming" contract Slice B owns end to end.
    await expect(page.getByText("Scroll to bottom")).toBeVisible();
  },
);
