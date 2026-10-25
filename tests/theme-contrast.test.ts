import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const themes: Record<string, Record<string, string>> = {};
postcss
  .parse(readFileSync("apps/web/app/globals.css", "utf8"))
  .walkRules((rule) => {
    if (![":root", ".dark"].includes(rule.selector)) return;
    const tokens: Record<string, string> = {};
    rule.walkDecls((declaration) => {
      tokens[declaration.prop] = declaration.value;
    });
    themes[rule.selector] = tokens;
  });

// WCAG sRGB relative luminance, retaining the HSL token's fractional channels.
// Rounding to 8-bit RGB before comparison can incorrectly pass a 4.49:1 pair.
function luminance(hsl: string) {
  const [hue, saturation, lightness] = hsl.split(/\s+/).map(parseFloat);
  const light = lightness / 100;
  const amplitude = (saturation / 100) * Math.min(light, 1 - light);
  const channel = (offset: number) => {
    const phase = (offset + hue / 30) % 12;
    const srgb =
      light - amplitude * Math.max(-1, Math.min(phase - 3, 9 - phase, 1));
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

describe.each([":root", ".dark"])("%s muted text minimum contrast", (theme) => {
  it.each(["--background", "--card", "--muted"])(
    "meets AA for small text on %s without rounding the colors",
    (surface) => {
      const tokens = themes[theme];
      const foreground = luminance(tokens["--muted-foreground"]);
      const background = luminance(tokens[surface]);
      const contrast =
        (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05);
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
  );
});
