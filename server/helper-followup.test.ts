import { describe, expect, it } from "vitest";

import { followupFacts } from "./helper-followup.ts";
import type { BotRecord } from "./store.ts";

const bot = (id: string, extra: Partial<BotRecord> = {}) => ({ id, name: id, ...extra }) as BotRecord;

describe("followupFacts", () => {
  it("does not count the Cartographe, nor its routines, as the person's own bots", () => {
    const maus = bot("maus");
    const bots = [maus, bot("scout"), bot("carto")];
    const routines = [{ botId: "carto", enabled: true }, { botId: "scout", enabled: true }];
    expect(followupFacts(maus, { ai: "own", apps: [] }, bots, routines)).toMatchObject({ bots: 2, routines: 2 });
    expect(followupFacts(maus, { ai: "own", apps: [] }, bots, routines, "carto")).toMatchObject({ bots: 1, routines: 1 });
  });
});
