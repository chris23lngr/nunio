import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom has no layout; InputOTP probes the point under its field for password managers.
document.elementFromPoint ??= () => null;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
