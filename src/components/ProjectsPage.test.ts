import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadLocale, setLocale } from "@/lib/i18n";
import { ProjectBlockHeaderActions } from "./ProjectsPage";

beforeEach(async () => { await loadLocale("fr"); });
afterEach(() => { setLocale("en"); });

describe("project block header", () => {
  it("offers the architecture map of the project next to linking and folding", () => {
    const html = renderToStaticMarkup(createElement(ProjectBlockHeaderActions, {
      name: "api", linking: false, collapsed: false, onMap: () => {}, onLink: () => {}, onFold: () => {},
    }));
    expect(html).toContain('aria-label="Ouvrir la carte de api"');
    expect(html).toContain('data-icon="Network"');
    expect(html).toContain('aria-label="Relier à un autre projet"');
    expect(html).toContain('aria-label="Plier / déplier"');
    expect(html.match(/<button/g)).toHaveLength(3);
  });
});
