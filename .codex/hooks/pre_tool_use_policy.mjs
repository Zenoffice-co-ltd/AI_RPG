import { stdin, stdout } from "node:process";

const readStdin = async () => {
  let input = "";
  for await (const chunk of stdin) {
    input += chunk;
  }
  return input.trim();
};

const destructivePolicies = [
  {
    pattern: /^git\s+reset\s+--hard(?:\s|$)/,
    reason: "Blocked destructive git reset. Use a targeted revert or confirm the exact recovery plan first.",
  },
  {
    pattern: /^git\s+checkout\s+--(?:\s|$)/,
    reason: "Blocked destructive checkout. Restore files with an explicit, reviewed action instead.",
  },
  {
    pattern: /^git\s+clean\s+-f(?:d|x|dx|xd)*(?:\s|$)/,
    reason: "Blocked destructive git clean. Preserve generated or local evidence unless cleanup is explicitly intended.",
  },
  {
    pattern: /^rm\s+-rf(?:\s|$)/,
    reason: "Blocked recursive delete. Use a narrower and reviewed file operation instead.",
  },
];

const main = async () => {
  const raw = await readStdin();
  if (!raw) {
    return;
  }

  const payload = JSON.parse(raw);
  const command = payload?.tool_input?.command;
  if (typeof command !== "string" || command.trim().length === 0) {
    return;
  }

  const matched = destructivePolicies.find((policy) => policy.pattern.test(command.trim()));
  if (!matched) {
    return;
  }

  stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: matched.reason,
      },
      systemMessage: matched.reason,
    }),
  );
};

await main();
