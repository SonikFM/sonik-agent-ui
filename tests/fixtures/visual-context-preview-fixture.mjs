import { createServer } from "node:http";

export const visualBrowserStateFixtures = Object.freeze({
  missing: { capability: "missing", setup: "idle", disabledReason: "Controlled browser capture is not installed." },
  launchFailed: { capability: "launch-failed", setup: "failed", disabledReason: "Controlled browser capture could not launch." },
  setupPending: { capability: "missing", setup: "pending", disabledReason: "Controlled browser setup is in progress." },
  setupSucceeded: { capability: "installed", setup: "succeeded", disabledReason: null },
});

export async function startVisualContextPreviewFixture() {
  const payment = createServer((_request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end('<body style="margin:0;background:#ef4444"><label>Card <input value="4111111111111111"></label></body>');
  });
  const paymentOrigin = await listen(payment);
  let navigations = 0;
  const preview = createServer((request, response) => {
    if (request.url !== "/visual-context-fixture") {
      response.writeHead(404).end();
      return;
    }
    navigations += 1;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html>
      <html><body data-navigation="${navigations}">
        <main aria-label="Safe preview">
          <p id="fresh-state">fresh-navigation-${navigations}</p>
          <section data-sonik-target="reservation.card" data-sonik-target-instance="primary" aria-label="Primary reservation">
            <input type="password" value="secret_password=never-emit-this">
            <p data-sonik-sensitive>access_token=never-emit-this-token</p>
            <iframe title="Payment" src="${paymentOrigin}/payment"></iframe>
          </section>
          <section data-sonik-target="reservation.card" data-sonik-target-instance="secondary" aria-label="Secondary reservation"></section>
          <div data-sonik-target="reservation.unique" aria-label="Unique reservation">Safe visible content</div>
        </main>
        <script>window.visibleIframeClientState = "not-present-in-fresh-navigation";</script>
      </body></html>`);
  });
  const origin = await listen(preview);
  return {
    origin,
    route: "/visual-context-fixture",
    navigationCount: () => navigations,
    async close() {
      await Promise.all([close(preview), close(payment)]);
    },
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
