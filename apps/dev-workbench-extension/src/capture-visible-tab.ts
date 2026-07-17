export type CaptureVisibleTabInput<T> = {
  hideCaptureChrome: () => Promise<void>;
  captureVisibleTab: () => Promise<T>;
  restoreCaptureChrome: () => Promise<void>;
};

export async function captureVisibleTabWithoutSonikChrome<T>({
  hideCaptureChrome,
  captureVisibleTab,
  restoreCaptureChrome,
}: CaptureVisibleTabInput<T>): Promise<T> {
  let result: T | undefined;
  let captureError: unknown;

  try {
    await hideCaptureChrome();
    result = await captureVisibleTab();
  } catch (error) {
    captureError = error;
  }

  try {
    await restoreCaptureChrome();
  } catch (restoreError) {
    if (captureError) throw new AggregateError([captureError, restoreError], "Capture and Sonik chrome restoration failed.");
    throw restoreError;
  }

  if (captureError) throw captureError;
  return result as T;
}
