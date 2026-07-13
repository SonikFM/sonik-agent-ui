#!/usr/bin/env python3
"""Gate 2 - Sonik enterprise UX residue checker.

Companion to scripts/check-design-metrics.py. Gate 1 owns numeric CSS craft
(type, spacing, margins, radii, shadows, weights, uppercase tracking). Gate 2
owns product-residue checks that make prototypes feel fake: raw color literals
outside theme layers, palette sprawl, native title tooltip residue, dead-looking
controls, and missing agent-readable contracts.

Usage: python3 scripts/check-enterprise-ux.py <files-or-dirs...>
Exit 0 clean · exit 2 findings.
"""
from html.parser import HTMLParser
import os
import re
import sys

EXCLUDE_PARTS = (
    "vendor",
    "tokens.css",
    "effects.css",
    "captures",
    "rendered-dom",
    "shots",
    "assets/fonts",
    "node_modules",
    ".svelte-kit",
    "storybook-static",
    "dist",
)

THEME_PARTS = ("/theme/", "booking/theme/", "/foundations/")
COLOR_FUNC = re.compile(r"\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\s*\(", re.I)
HEX = re.compile(r"(?<![\w-])#[0-9a-fA-F]{3,8}(?![\w-])")
NAMED_COLORS = {
    "black", "white", "red", "blue", "green", "yellow", "orange", "purple",
    "pink", "gray", "grey", "cyan", "magenta", "lime", "navy", "teal",
    "maroon", "silver", "gold",
}
SAFE_COLOR_WORDS = {"transparent", "currentcolor", "inherit", "initial", "unset"}

findings = []
raw_colors_by_file = {}


def add(path, line, rule, msg):
    findings.append(f"{path}:{line}  [{rule}]  {msg}")


def is_excluded(path):
    return any(part in path for part in EXCLUDE_PARTS)


def is_theme(path):
    norm = path.replace(os.sep, "/")
    return any(part in norm for part in THEME_PARTS)


def collect(paths):
    out = []
    for path in paths:
        if os.path.isdir(path):
            for root, _, files in os.walk(path):
                for name in sorted(files):
                    fp = os.path.join(root, name)
                    if fp.endswith((".html", ".css", ".js", ".svelte")) and not is_excluded(fp):
                        out.append(fp)
        elif path.endswith((".html", ".css", ".js", ".svelte")) and not is_excluded(path):
            out.append(path)
    return out


def line_for(text, index):
    return text.count("\n", 0, index) + 1


def scan_colors(path, text):
    if is_theme(path):
        return
    colors = set()
    for match in HEX.finditer(text):
        line_start = text.rfind("\n", 0, match.start()) + 1
        line_end = text.find("\n", match.end())
        if line_end == -1:
            line_end = len(text)
        line = text[line_start:line_end].lower()
        if "href=" in line or "location.hash" in line or "hashchange" in line:
            continue
        colors.add(match.group(0).lower())
        add(path, line_for(text, match.start()), "G2.1-color-literal",
            f"raw color literal {match.group(0)} outside theme layer")
    for match in COLOR_FUNC.finditer(text):
        value = match.group(0).strip()
        colors.add(value.lower())
        add(path, line_for(text, match.start()), "G2.1-color-literal",
            f"raw color function {value} outside theme layer")

    # Named colors are only flagged in declarations/attributes, not incidental copy.
    for match in re.finditer(r":\s*([a-zA-Z]+)\s*[;'}\"]", text):
        name = match.group(1).lower()
        if name in NAMED_COLORS and name not in SAFE_COLOR_WORDS:
            colors.add(name)
            add(path, line_for(text, match.start(1)), "G2.1-color-literal",
                f"named color {name} outside theme layer")
    if colors:
        raw_colors_by_file[path] = colors
        add(path, 0, "G2.2-color-sprawl",
            f"{len(colors)} distinct raw color value(s); bind colors to theme tokens")


def has_reason(attrs):
    joined = " ".join(f"{k}={v or ''}" for k, v in attrs.items()).lower()
    return (
        "disabledreason" in joined
        or "data-disabled-reason" in joined
        or "aria-describedby" in attrs
        or ("title" in attrs and any(s in (attrs.get("title") or "").lower()
            for s in ("not built", "not mounted", "not available", "isn't built", "isn’t built", "disabled")))
    )


class UXParser(HTMLParser):
    def __init__(self, path):
        super().__init__(convert_charrefs=True)
        self.path = path
        self.saw_shell_body = False
        self.saw_agent_contract = False

    def handle_starttag(self, tag, attrs_list):
        # Svelte adaptation: capitalized tags are components — their props
        # (including `title`) are not DOM attributes, so native-tooltip and
        # dead-control checks don't apply.
        raw = self.get_starttag_text() or ""
        if raw[1:2].isupper():
            return
        attrs = {k.lower(): (v if v is not None else "") for k, v in attrs_list}
        line = self.getpos()[0]
        if tag == "body" and "data-shell-active" in attrs:
            self.saw_shell_body = True

        # G2.3 exception (DESIGN-GATES.md): title is allowed when the element
        # carries the unavailable-reason contract. Svelte dynamic attrs
        # (aria-disabled={expr}) can't be evaluated statically, so has_reason
        # accepts elements whose attribute text references disabledReason.
        if "title" in attrs and not (
            "disabled" in attrs
            or attrs.get("aria-disabled") == "true"
            or has_reason(attrs)
        ):
            add(self.path, line, "G2.3-native-title",
                "native title tooltip on active UI; use visible copy, toast, or custom tooltip")

        if tag == "a":
            href = attrs.get("href", "")
            has_action_contract = any(
                k.startswith("data-") and k not in ("data-od-id",)
                for k in attrs
            )
            if href in ("", "#") and not (
                has_action_contract or attrs.get("aria-disabled") == "true"
            ):
                add(self.path, line, "G2.4-dead-control",
                    "anchor has no real destination and no stub/disabled contract")
            if attrs.get("aria-disabled") == "true" and not has_reason(attrs):
                add(self.path, line, "G2.5-disabled-reason",
                    "aria-disabled link lacks a human-visible or agent-readable reason")

        if tag == "button":
            disabled = "disabled" in attrs or attrs.get("aria-disabled") == "true"
            if disabled and not has_reason(attrs):
                add(self.path, line, "G2.5-disabled-reason",
                    "disabled button lacks a human-visible or agent-readable reason")
            if (not disabled and "type" not in attrs and "onclick" not in attrs
                    and "id" not in attrs and not any(k.startswith("data-") for k in attrs)):
                add(self.path, line, "G2.4-dead-control",
                    "button has no id/type/onclick/data contract visible to static audit")

    def handle_data(self, data):
        if "__sonikAgentUI" in data:
            self.saw_agent_contract = True


def scan_html_structure(path, text):
    parser = UXParser(path)
    try:
        parser.feed(text)
    except Exception as exc:
        add(path, 0, "G2.0-parse", f"HTML parse error: {exc}")
        return
    if parser.saw_shell_body and not parser.saw_agent_contract:
        add(path, 0, "G2.6-agent-contract",
            "shell screen lacks window.__sonikAgentUI contract")


def scan_js_markup(path, text):
    if "title=" in text:
        for match in re.finditer(r"(?<![\w-])title=\\?[\"']", text):
            # Svelte adaptation: skip title= props on component tags
            # (nearest preceding tag opener starts with an uppercase letter).
            lt = text.rfind("<", 0, match.start())
            if lt >= 0 and text[lt + 1 : lt + 2].isupper():
                continue
            start = max(0, match.start() - 160)
            end = min(len(text), match.start() + 240)
            snippet = text[start:end].lower()
            if "aria-disabled" not in snippet and "disabled" not in snippet:
                add(path, line_for(text, match.start()), "G2.3-native-title",
                    "generated markup adds native title tooltip without disabled-state reason")

    # Topbar icon buttons need either a known handler, a stub contract, or a disabled reason.
    for match in re.finditer(r"<button[^>]*class=\\?[\"'][^\"']*top-icon[^>]*>", text):
        markup = match.group(0)
        lower = markup.lower()
        if all(s not in lower for s in ("id=", "onclick=", "data-", "aria-disabled", "type=")):
            add(path, line_for(text, match.start()), "G2.4-dead-control",
                "generated top-icon button lacks id/type/handler/stub/disabled contract")


def main():
    targets = collect(sys.argv[1:] or ["booking/screens"])
    for path in targets:
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read()
        scan_colors(path, text)
        if path.endswith((".html", ".svelte")):
            scan_html_structure(path, text)
        if path.endswith(".js") or "<script" in text:
            scan_js_markup(path, text)

    per_rule = {}
    for finding in findings:
        rule = finding.split("[", 1)[1].split("]", 1)[0]
        per_rule[rule] = per_rule.get(rule, 0) + 1
    for finding in findings:
        print(finding)
    print(
        f"\nScanned {len(targets)} file(s). "
        + (
            "FAIL - "
            + str(len(findings))
            + " finding(s): "
            + ", ".join(f"{k}={v}" for k, v in sorted(per_rule.items()))
            if findings
            else "PASS - clean."
        )
    )
    sys.exit(2 if findings else 0)


if __name__ == "__main__":
    main()
