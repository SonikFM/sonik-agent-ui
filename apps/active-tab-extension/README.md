# Sonik Exact Active Tab

Developer-only MV3 extension for the Dev Workbench Host visual source.

1. Load this directory as an unpacked extension in Chrome.
2. Open the host page containing the embedded Dev Workbench.
3. Click the extension action to grant and bind the current active tab.
4. In Dev Workbench, select **Host**, then choose **Pair Extension**.

The grant is memory-only and ends when the service worker restarts, the tab changes, or the active-tab check fails. The manifest intentionally has only `activeTab` and `scripting`; it has no host, history, tabs, storage, or network permissions.
