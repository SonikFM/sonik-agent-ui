import assert from "node:assert/strict";
import { parseInline, renderChatText } from "../../packages/chat-surface/src/chat-text.ts";

const blocks = renderChatText(`# Movie table\n\n| Movie | Rating |\n| --- | ---: |\n| Zoolander | **7.0** |\n| Mystery Men | \`6.1\` |\n\n- keeps markdown readable\n- renders lists\n\n\`\`\`ts\nconst safe = true;\n\`\`\``);

assert.equal(blocks[0].kind, "heading");
assert.equal(blocks[0].level, 1);
assert.equal(blocks[1].kind, "table");
assert.equal(blocks[1].headers[0][0].text, "Movie");
assert.equal(blocks[1].rows[0][1][0].kind, "strong");
assert.equal(blocks[2].kind, "list");
assert.equal(blocks[2].items.length, 2);
assert.equal(blocks[3].kind, "code");
assert.equal(blocks[3].language, "ts");

const inline = parseInline("Visit [docs](https://example.com), avoid [xss](javascript:alert(1)), use **bold** and `code`.");
assert.equal(inline.some((token) => token.kind === "link" && token.href === "https://example.com"), true, "safe http links should render as link tokens");
assert.equal(inline.some((token) => token.kind === "link" && token.href.startsWith("javascript:")), false, "unsafe javascript links should not render as links");
assert.equal(inline.some((token) => token.kind === "strong" && token.text === "bold"), true, "bold markdown should parse");
assert.equal(inline.some((token) => token.kind === "code" && token.text === "code"), true, "inline code markdown should parse");

const rawHtml = renderChatText("<img src=x onerror=alert(1)>");
assert.equal(rawHtml[0].kind, "paragraph");
assert.equal(rawHtml[0].tokens[0].text, "<img src=x onerror=alert(1)>", "raw HTML should remain text for Svelte escaping");

console.log("chat-text tests passed");
