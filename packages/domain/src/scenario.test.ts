import { describe, expect, it } from "vitest";
import {
  ADECCO_MANUFACTURER_SCENARIO_ID,
  BUILTIN_SCENARIO_SUMMARIES,
  PUBLISHABLE_SCENARIO_IDS,
} from "./scenario";

describe("scenario registry", () => {
  it("exposes the Adecco manufacturer scenario as builtin and publishable", () => {
    expect(
      BUILTIN_SCENARIO_SUMMARIES.find(
        (scenario) => scenario.id === ADECCO_MANUFACTURER_SCENARIO_ID
      )
    ).toMatchObject({
      id: ADECCO_MANUFACTURER_SCENARIO_ID,
      difficulty: "medium",
    });
    expect(PUBLISHABLE_SCENARIO_IDS).toContain(ADECCO_MANUFACTURER_SCENARIO_ID);
  });
});
