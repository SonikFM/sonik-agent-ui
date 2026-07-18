# Sonik Exact Active Tab

Developer-only MV3 extension for the Dev Workbench Host visual source.

It is optional and host-neutral: any app that embeds the Workbench can adopt it without an Amplify dependency.

1. Load this directory as an unpacked extension in Chrome.
2. Open the host page containing the embedded Dev Workbench.
   The host bridge must mark that iframe with `data-sonik-dev-workbench-origin="<exact Workbench origin>"`.
3. Click the extension action to grant and bind the current active tab.
4. In Dev Workbench, select **Host**, then choose **Pair Extension**.

The host must use the product-neutral `sonik.visual-context.v1` request/result contract. The extension supplies redacted active-tab pixels only; semantic target identity remains owned by the host integration.

The grant is memory-only and ends when the service worker restarts, the tab changes, or the active-tab check fails. The manifest intentionally has only `activeTab` and `scripting`; it has no host, history, tabs, storage, or network permissions.
