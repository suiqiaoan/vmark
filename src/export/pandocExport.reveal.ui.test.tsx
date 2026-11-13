import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

vi.unmock("@/i18n");
vi.mock("@/hooks/useIsDarkTheme", () => ({ useIsDarkTheme: () => false }));

const { reveal } = vi.hoisted(() => ({ reveal: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: reveal }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    if (command === "detect_pandoc") return { available: true };
    if (command === "pick_export_target") return "/Users/test/导出/报告.docx";
    return undefined;
  },
}));

import i18n from "@/i18n";
import { toast } from "sonner";
import { ThemedToaster } from "@/components/ThemedToaster";
import { exportViaPandoc } from "./pandocExport";

afterEach(() => {
  toast.dismiss();
  cleanup();
  vi.unstubAllGlobals();
});

it("shows a translated top-right action without a mounted sidebar and reveals the export on click", async () => {
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  await i18n.changeLanguage("zh-CN");
  i18n.removeResourceBundle("zh-CN", "sidebar");
  i18n.removeResourceBundle("en", "sidebar");
  render(<ThemedToaster />);

  await act(async () => {
    expect(await exportViaPandoc({ markdown: "# 报告", format: "docx" })).toBe(true);
  });

  const button = await screen.findByRole("button", { name: "在 Finder 中显示" });
  const toaster = button.closest("[data-sonner-toaster]");
  expect(toaster).toHaveAttribute("data-x-position", "right");
  expect(toaster).toHaveAttribute("data-y-position", "top");
  expect(reveal).not.toHaveBeenCalled();
  // jsdom does not implement the pointer capture Sonner uses for swiping.
  Object.defineProperty(button, "setPointerCapture", { value: vi.fn() });
  await userEvent.setup().click(button);
  await waitFor(() => expect(reveal).toHaveBeenCalledExactlyOnceWith("/Users/test/导出/报告.docx"));
});
