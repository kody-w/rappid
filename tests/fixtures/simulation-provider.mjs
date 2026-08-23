import { spawn } from "node:child_process";

export async function executeReplica({
  replica,
  plan,
  provider_data: data,
}) {
  if (data.mode === "pattern-94") {
    return replica < 94
      ? { output: "stable" }
      : { output: `${data.outlier_prefix}-${replica}` };
  }
  if (data.mode === "aggregate-overflow") {
    return { replica, output: "x".repeat(6000) };
  }
  if (data.mode === "mutate-plan") {
    let mutationBlocked = false;
    try {
      plan.policy.minimum_matching = 2;
    } catch {
      mutationBlocked = true;
    }
    return {
      output: replica < 2 ? "stable" : "outlier",
      observed_minimum: plan.policy.minimum_matching,
      mutation_blocked: mutationBlocked,
    };
  }
  if (data.mode === "never") {
    return new Promise(() => {});
  }
  if (data.mode === "ignore-term") {
    try {
      process.on("SIGTERM", () => {});
    } catch {
      // Windows has no catchable SIGTERM; the provider still never settles.
    }
    return new Promise(() => {});
  }
  if (data.mode === "descendant") {
    spawn(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ], {
      stdio: "inherit",
      windowsHide: true,
    });
    return new Promise(() => {});
  }
  if (data.mode === "detached-descendant") {
    spawn(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ], {
      detached: true,
      stdio: "inherit",
      windowsHide: true,
    });
    return new Promise(() => {});
  }
  if (data.mode === "oversized") {
    return { output: "x".repeat(20 * 1024 * 1024) };
  }
  if (data.mode === "stdout-overflow") {
    process.stdout.write("x".repeat(1024 * 1024));
    process.exit(0);
  }
  if (data.mode === "stable-with-error") {
    await new Promise((resolve) => setTimeout(resolve, 1));
    if (replica === data.error_replica) {
      throw new Error("synthetic provider error");
    }
    return { output: "stable" };
  }
  throw new Error(`unknown simulation provider mode: ${data.mode}`);
}
