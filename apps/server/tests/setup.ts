import { Test } from "supertest";
import { WORKBENCH_MUTATION_HEADER_NAME, WORKBENCH_MUTATION_HEADER_VALUE } from "@workbench/contracts";

const originalEnd = Test.prototype.end;
Test.prototype.end = function end(callback) {
  const candidate = this as typeof this & { method?: string; header?: Record<string, string> };
  const mutation = ["POST", "PUT", "PATCH", "DELETE"].includes(candidate.method ?? "");
  const alreadySet = Object.keys(candidate.header ?? {}).some((name) => name.toLowerCase() === WORKBENCH_MUTATION_HEADER_NAME.toLowerCase());
  if (mutation && !alreadySet) this.set(WORKBENCH_MUTATION_HEADER_NAME, WORKBENCH_MUTATION_HEADER_VALUE);
  return originalEnd.call(this, callback);
};
