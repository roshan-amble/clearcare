// doctext: prints the text of a PDF or an image as JSON, using macOS's own PDF reader and text recognition.
// Usage: doctext <file>  ->  {"method":"PDF"|"OCR","pages":["...", ...]}
// It reads only the file it is given and uses no network. A PDF page without a text layer (a scan) is rendered
// and its text recognized, as a picture is.

import AppKit
import Foundation
import PDFKit
import Vision

func recognize(_ image: CGImage) -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do { try handler.perform([request]) } catch { return "" }
    let observations = request.results ?? []
    // Reading order: top to bottom, then left to right. Vision's y axis points up.
    let sorted = observations.sorted { a, b in
        let ay = a.boundingBox.midY, by = b.boundingBox.midY
        if abs(ay - by) > 0.01 { return ay > by }
        return a.boundingBox.minX < b.boundingBox.minX
    }
    var lines: [String] = []
    var lastY: CGFloat? = nil
    for o in sorted {
        guard let text = o.topCandidates(1).first?.string else { continue }
        let y = o.boundingBox.midY
        if let ly = lastY, abs(ly - y) <= 0.01, !lines.isEmpty {
            lines[lines.count - 1] += "  " + text
        } else {
            lines.append(text)
        }
        lastY = y
    }
    return lines.joined(separator: "\n")
}

func cgImage(_ image: NSImage) -> CGImage? {
    var rect = NSRect(origin: .zero, size: image.size)
    return image.cgImage(forProposedRect: &rect, context: nil, hints: nil)
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

guard CommandLine.arguments.count == 2 else { fail("usage: doctext <file>") }
let url = URL(fileURLWithPath: CommandLine.arguments[1])
var method = "PDF"
var pages: [String] = []

if url.pathExtension.lowercased() == "pdf" {
    guard let pdf = PDFDocument(url: url) else { fail("not a readable PDF") }
    if pdf.isLocked { fail("the PDF is password-protected") }
    for i in 0..<pdf.pageCount {
        guard let page = pdf.page(at: i) else { pages.append(""); continue }
        let text = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if text.count >= 20 {
            pages.append(text)
            continue
        }
        // A scanned page: render it at about 200 dpi and recognize the text.
        let bounds = page.bounds(for: .mediaBox)
        let scale: CGFloat = 200.0 / 72.0
        let size = NSSize(width: bounds.width * scale, height: bounds.height * scale)
        let thumb = page.thumbnail(of: size, for: .mediaBox)
        if let image = cgImage(thumb) {
            let found = recognize(image)
            if !found.isEmpty { method = "OCR" }
            pages.append(found.isEmpty ? text : found)
        } else {
            pages.append(text)
        }
    }
} else {
    method = "OCR"
    guard let image = NSImage(contentsOf: url), let cg = cgImage(image) else { fail("not a readable image") }
    pages.append(recognize(cg))
}

let out = try JSONSerialization.data(withJSONObject: ["method": method, "pages": pages], options: [])
FileHandle.standardOutput.write(out)
