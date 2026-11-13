// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PANDOC_FORMAT_KEYS } from "./pandocFormats";

interface SuccessOptions {
  position: string;
  duration: number;
  action: { label: string; onClick: () => void };
}

const { mockInvoke, mockReveal, mockToast } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockReveal: vi.fn(),
  mockToast: {
    success: vi.fn<(message: string, options?: SuccessOptions) => void>(),
    error: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: mockReveal }));
vi.mock("sonner", () => ({ toast: mockToast }));

import { exportViaPandoc } from "./pandocExport";

const outputPath = "/Users/test/导出 文件/报告 #1.docx";

function successOptions(): SuccessOptions {
  const options = mockToast.success.mock.lastCall?.[1];
  expect(options).toBeDefined();
  if (!options) throw new Error("Export success toast has no action");
  return options;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  mockReveal.mockResolvedValue(undefined);
  mockInvoke.mockImplementation(async (command: string) => {
    if (command === "detect_pandoc") return { available: true };
    if (command === "pick_export_target") return outputPath;
    return undefined;
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("Pandoc export reveal action", () => {
  it.each(PANDOC_FORMAT_KEYS)("offers to reveal a successful %s export at the top right", async (format) => {
    expect(await exportViaPandoc({ markdown: "# Hello", format })).toBe(true);

    const options = successOptions();
    expect(options.position).toBe("top-right");
    expect(options.duration).toBeGreaterThanOrEqual(10000);
    expect(options.action.label).toBe("Reveal in Finder");
    expect(mockReveal).not.toHaveBeenCalled();

    options.action.onClick();
    expect(mockReveal).toHaveBeenCalledExactlyOnceWith(outputPath);
  });

  it.each([
    ["Win32", "C:\\Users\\test\\Downloads\\report.docx", "Show in Explorer"],
    ["Linux x86_64", "/home/test/Downloads/report.docx", "Show in File Manager"],
  ])("uses the file manager label and selected path on %s", async (platform, path, label) => {
    vi.stubGlobal("navigator", { platform });
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "detect_pandoc") return { available: true };
      if (command === "pick_export_target") return path;
      return undefined;
    });

    await exportViaPandoc({ markdown: "# Hello", format: "docx" });
    const { action } = successOptions();
    expect(action.label).toBe(label);
    action.onClick();
    expect(mockReveal).toHaveBeenCalledWith(path);
  });

  it("waits for export completion before offering the action", async () => {
    let completeExport: (() => void) | undefined;
    const completed = new Promise<void>((resolve) => { completeExport = resolve; });
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "detect_pandoc") return { available: true };
      if (command === "pick_export_target") return outputPath;
      return completed;
    });

    const exported = exportViaPandoc({ markdown: "# Hello", format: "docx" });
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("export_via_pandoc", expect.any(Object)));
    expect(mockToast.success).not.toHaveBeenCalled();
    completeExport?.();
    await exported;
    expect(successOptions().action.label).toBe("Reveal in Finder");
  });

  it.each(["cancelled", "failed"])("does not offer a reveal action when export is %s", async (outcome) => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "detect_pandoc") return { available: true };
      if (command === "pick_export_target") return outcome === "cancelled" ? null : outputPath;
      throw new Error("Pandoc failed");
    });

    expect(await exportViaPandoc({ markdown: "# Hello", format: "docx" })).toBe(false);
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockReveal).not.toHaveBeenCalled();
  });

  it("reports a reveal failure without changing the successful export result", async () => {
    const error = new Error("File was moved or permission denied");
    mockReveal.mockRejectedValueOnce(error);

    expect(await exportViaPandoc({ markdown: "# Hello", format: "docx" })).toBe(true);
    successOptions().action.onClick();
    await vi.waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(
      "Failed to reveal in Finder.",
      expect.objectContaining({ description: error.message }),
    ));
    expect(mockToast.error).not.toHaveBeenCalledWith("Pandoc export failed", expect.anything());
  });

  it("keeps the correct target for each of several successful exports", async () => {
    await exportViaPandoc({ markdown: "First", format: "docx" });
    const first = successOptions().action;
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "detect_pandoc") return { available: true };
      if (command === "pick_export_target") return "/tmp/second.epub";
      return undefined;
    });
    await exportViaPandoc({ markdown: "Second", format: "epub" });
    const second = successOptions().action;

    first.onClick();
    second.onClick();
    expect(mockReveal.mock.calls).toEqual([[outputPath], ["/tmp/second.epub"]]);
  });
});
