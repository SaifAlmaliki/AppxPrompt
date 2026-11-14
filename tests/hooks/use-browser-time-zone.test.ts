import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { browserTimeZone, useBrowserTimeZone } from "@/hooks/use-browser-time-zone";

describe("useBrowserTimeZone", () => {
  it("reads the zone the runtime resolves", () => {
    expect(browserTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("is undefined when rendered on the server", () => {
    function Probe() {
      return createElement("span", null, String(useBrowserTimeZone()));
    }
    expect(renderToString(createElement(Probe))).toContain("undefined");
  });
});
