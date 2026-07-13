#!/usr/bin/env python3
"""Gate 1 — deterministic design-metrics checker (see booking/DESIGN-GATES.md).

Scans screen CSS (raw .css files + <style> blocks in .html) for violations of
the measured enterprise norms: 4px spacing grid, radius caps, no literal
shadows in screens, fixed type scale, <=3 weights, uppercase tracking.

Usage: python3 scripts/check-design-metrics.py <files-or-dirs...>
Exit 0 clean · exit 2 findings. Never scans vendor/, tokens.css, effects.css.
"""
import re, sys, os

SPACING_ALLOWED = {0, 1, 2, 4, 6, 8, 12, 16, 20, 24, 28, 32, 40, 48, 64}
SIZE_ALLOWED = {11, 12, 14, 16, 20, 24, 30}
RADIUS_MAX = 10
MAX_WEIGHTS = 3
MIN_CAPS_TRACKING = 0.06

SPACING_PROPS = re.compile(r'^(padding|margin|gap|row-gap|column-gap|padding-[a-z-]+|margin-[a-z-]+)$')
PX = re.compile(r'(-?[\d.]+)px')
FONT_SHORTHAND = re.compile(r'font:\s*(?:(\d{3})\s+)?([\d.]+)px')
EXCLUDE = ('vendor', 'tokens.css', 'effects.css', 'captures', 'rendered-dom',
           'node_modules', '.svelte-kit', 'storybook-static', 'dist',
           'foundations/themes', 'foundations/effects', 'foundations/gunmetal')

findings = []
weights = {}

def add(f, ln, rule, msg):
    findings.append(f"{f}:{ln}  [{rule}]  {msg}")

def css_sources(path):
    """Yield (file, line_offset, css_text) units."""
    text = open(path, encoding='utf-8', errors='replace').read()
    if path.endswith('.css'):
        yield path, 0, text
    else:
        for m in re.finditer(r'<style[^>]*>(.*?)</style>', text, re.S):
            yield path, text[:m.start(1)].count('\n'), m.group(1)

def check_decl(f, ln, prop, value):
    if 'var(' in value:
        return  # token-bound: theme layer owns it
    if SPACING_PROPS.match(prop):
        if 'clamp(' in value:
            return
        for v in PX.findall(value):
            n = abs(float(v))
            if n != int(n) or int(n) not in SPACING_ALLOWED:
                add(f, ln, 'G1.1-spacing', f"{prop}: {v}px off the 4px grid")
    elif prop == 'border-radius':
        for v in PX.findall(value):
            n = float(v)
            if RADIUS_MAX < n < 999:
                add(f, ln, 'G1.2-radius', f"border-radius {v}px (max {RADIUS_MAX}px, or 999+ pill)")
    elif prop == 'box-shadow' and value.strip() not in ('none',):
        add(f, ln, 'G1.3-shadow', "literal box-shadow in screen CSS (must come from --app-* token)")
    elif prop == 'font-size':
        if 'clamp(' in value:
            return  # approved-hero exemption
        for v in PX.findall(value):
            n = float(v)
            if n not in SIZE_ALLOWED:
                add(f, ln, 'G1.4-type', f"font-size {v}px off scale {sorted(SIZE_ALLOWED)}")
    elif prop == 'font-weight':
        m = re.match(r'\s*(\d{3})', value)
        if m:
            weights.setdefault(m.group(1), (f, ln))

def check_css(f, off, css):
    # declaration-level checks
    for i, line in enumerate(css.split('\n')):
        ln = off + i + 1
        for decl in line.split(';'):
            if ':' not in decl or '//' in decl[:2]:
                continue
            prop, _, value = decl.partition(':')
            prop = prop.strip().split('{')[-1].strip()
            check_decl(f, ln, prop, value)
        # font shorthand: weight + size
        for m in FONT_SHORTHAND.finditer(line):
            w, size = m.group(1), float(m.group(2))
            if w:
                weights.setdefault(w, (f, ln))
            if 'clamp(' not in line and size not in SIZE_ALLOWED:
                add(f, ln, 'G1.4-type', f"font size {m.group(2)}px (shorthand) off scale")
    # block-level: uppercase needs tracking >= 0.06em
    for m in re.finditer(r'\{([^{}]*)\}', css):
        block = m.group(1)
        if 'text-transform' in block and 'uppercase' in block:
            ln = off + css[:m.start()].count('\n') + 1
            ls = re.search(r'letter-spacing:\s*([\d.]+)em', block)
            if not ls or float(ls.group(1)) < MIN_CAPS_TRACKING:
                add(f, ln, 'G1.6-caps', "uppercase without letter-spacing >= 0.06em in same block")

def collect(paths):
    out = []
    for p in paths:
        if os.path.isdir(p):
            for root, _, files in os.walk(p):
                for fn in sorted(files):
                    fp = os.path.join(root, fn)
                    if fn.endswith(('.css', '.html', '.svelte')) and not any(x in fp for x in EXCLUDE):
                        out.append(fp)
        elif p.endswith(('.css', '.html', '.svelte')) and not any(x in p for x in EXCLUDE):
            out.append(p)
    return out

def main():
    targets = collect(sys.argv[1:] or ['booking/screens'])
    for f in targets:
        for f_, off, css in css_sources(f):
            check_css(f_, off, css)
    if len(weights) > MAX_WEIGHTS:
        listing = ', '.join(f"{w} ({f}:{ln})" for w, (f, ln) in sorted(weights.items()))
        add('(bundle)', 0, 'G1.5-weights', f"{len(weights)} distinct font-weights (max {MAX_WEIGHTS}): {listing}")
    per_rule = {}
    for x in findings:
        rule = x.split('[')[1].split(']')[0]
        per_rule[rule] = per_rule.get(rule, 0) + 1
    for x in findings:
        print(x)
    print(f"\nScanned {len(targets)} file(s). "
          + (f"FAIL — {len(findings)} finding(s): " + ', '.join(f'{k}={v}' for k, v in sorted(per_rule.items()))
             if findings else "PASS — clean."))
    sys.exit(2 if findings else 0)

main()
