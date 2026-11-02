import { describe, expect, it } from "vitest";

import { onOpenWorkflowRequest, requestOpenWorkflow, takeOpenWorkflowRequest, workflowOfRoutine } from "./open-request";

describe("opening a workflow from elsewhere in the app", () => {
  it("finds the workflow of a workflow routine, and none for a bot routine", () => {
    expect(workflowOfRoutine({ target: "workflow", workflowId: "w1", botId: "workflow:routine" })).toBe("w1");
    expect(workflowOfRoutine({ target: "bot", botId: "b1" })).toBeNull();
    expect(workflowOfRoutine({ target: "workflow", botId: "workflow:routine" })).toBeNull();
    expect(workflowOfRoutine(undefined)).toBeNull();
  });

  it("keeps a request until the Atelier takes it, and tells an Atelier already open", () => {
    requestOpenWorkflow("w1");
    expect(takeOpenWorkflowRequest()).toBe("w1");
    expect(takeOpenWorkflowRequest()).toBeNull();
    const heard: string[] = [];
    const stop = onOpenWorkflowRequest((id) => heard.push(id));
    requestOpenWorkflow("w2");
    stop();
    requestOpenWorkflow("w3");
    expect(heard).toEqual(["w2"]);
    expect(takeOpenWorkflowRequest()).toBe("w3");
  });
});
