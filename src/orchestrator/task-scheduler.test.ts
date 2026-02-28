import { describe, it, expect } from "@jest/globals";
import { getReadyTasks } from "./task-scheduler.js";
import type { TaskRecord } from "./types.js";

function task(overrides: Partial<TaskRecord> & { id: string }): TaskRecord {
  return {
    task_type: "test",
    agent_name: "test-agent",
    payload: {},
    status: "pending",
    dependencies: [],
    created_at: new Date(),
    started_at: null,
    completed_at: null,
    error_message: null,
    ...overrides,
  };
}

describe("getReadyTasks", () => {
  it("returns tasks with no dependencies", () => {
    const tasks = [
      task({ id: "a" }),
      task({ id: "b" }),
    ];
    const ready = getReadyTasks(tasks);
    expect(ready.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("excludes tasks with pending dependencies", () => {
    const tasks = [
      task({ id: "a" }),
      task({ id: "b", dependencies: ["a"] }),
    ];
    const ready = getReadyTasks(tasks);
    expect(ready.map((t) => t.id)).toEqual(["a"]);
  });

  it("includes tasks whose dependencies are completed", () => {
    const tasks = [
      task({ id: "a", status: "completed" }),
      task({ id: "b", dependencies: ["a"] }),
    ];
    const ready = getReadyTasks(tasks);
    expect(ready.map((t) => t.id)).toEqual(["b"]);
  });

  it("excludes running and completed tasks", () => {
    const tasks = [
      task({ id: "a", status: "running" }),
      task({ id: "b", status: "completed" }),
      task({ id: "c" }),
    ];
    const ready = getReadyTasks(tasks);
    expect(ready.map((t) => t.id)).toEqual(["c"]);
  });

  it("excludes tasks with failed dependencies", () => {
    const tasks = [
      task({ id: "a", status: "failed" }),
      task({ id: "b", dependencies: ["a"] }),
    ];
    const ready = getReadyTasks(tasks);
    expect(ready).toEqual([]);
  });
});
