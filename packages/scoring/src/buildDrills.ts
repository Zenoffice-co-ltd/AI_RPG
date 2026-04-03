import { DRILL_LIBRARY, type ScenarioPack, type Scorecard } from "@top-performer/domain";

export function buildDrills(input: {
  scenario: ScenarioPack;
  scorecard: Scorecard;
}): string[] {
  const missedKeys = new Set(
    input.scorecard.mustCaptureResults
      .filter((item) => item.status !== "captured")
      .map((item) => item.key)
  );

  const drillKeys = new Set<string>();

  if (missedKeys.has("start_date") || missedKeys.has("urgency")) {
    drillKeys.add("start_date_urgency");
  }
  if (missedKeys.has("decision_maker") || missedKeys.has("selection_flow")) {
    drillKeys.add("decision_maker");
  }
  if (
    missedKeys.has("unacceptable_conditions") ||
    missedKeys.has("budget_flexibility") ||
    missedKeys.has("competing_agencies")
  ) {
    drillKeys.add("constraints");
  }
  if (missedKeys.has("recap_confirmation")) {
    drillKeys.add("recap_confirmation");
  }
  if (missedKeys.has("next_step_commitment")) {
    drillKeys.add("close_next_step");
  }
  if (missedKeys.has("competing_agencies")) {
    drillKeys.add("competing_agencies");
  }

  if (drillKeys.size === 0) {
    drillKeys.add("recap_confirmation");
    drillKeys.add("close_next_step");
  }

  return DRILL_LIBRARY.filter((drill) => drillKeys.has(drill.key)).map(
    (drill) => drill.label
  );
}
