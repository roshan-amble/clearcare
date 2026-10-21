import { describe, expect, it } from "vitest";
import { addFile, cleanFileName, removeFile } from "./files.js";
import { emptyState } from "./types.js";

const NOW = "2026-10-19T09:00";

describe("stored files", () => {
  it("keeps only a plain file name", () => {
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("C:\\\\Users\\\\mom\\\\lab report.pdf")).toBe("lab report.pdf");
    expect(cleanFileName(".hidden")).toBe("hidden");
    expect(cleanFileName("a\u0007b.png")).toBe("ab.png");
    expect(cleanFileName("")).toBe("document");
  });
  it("stores under its ID with the original extension, and removes it", () => {
    const { state, file } = addFile(emptyState(NOW), { name: "Lab Results.PDF", type: "application/pdf", size: 1200, by: "Mom" }, NOW);
    expect(file).toMatchObject({ id: "FILE-1", name: "Lab Results.PDF", stored: "FILE-1.pdf", by: "Mom" });
    expect(state.revision).toBe(0);
    expect(removeFile(state, "FILE-1").state.files).toEqual([]);
  });
  it("refuses empty and oversized files", () => {
    expect(() => addFile(emptyState(NOW), { name: "a.txt", type: "text/plain", size: 0 }, NOW)).toThrow(/empty/);
    expect(() => addFile(emptyState(NOW), { name: "a.mov", type: "video/quicktime", size: 60 * 1024 * 1024 }, NOW)).toThrow(/50 MB/);
  });
});
