// print-tspl.js — builds TSPL2 command text from a label template + field
// values. Pure, no DOM/network, loaded as a plain global-scope <script>
// like task-verdicts.js. The print bridge (print-bridge/) never runs this
// file — it only ever relays the string this produces.

// TSC desktop-class printers (DA-series included) are commonly 203dpi.
// Not confirmed against this specific unit -- see Task 8 of
// docs/superpowers/plans/2026-08-31-print-bridge.md. If labels come out
// the wrong size/position on real hardware, this is the first constant
// to check.
const PRINTER_DPI = 203;
const DOTS_PER_MM = PRINTER_DPI / 25.4;

function mmToDots(mm) {
    return Math.round(Number(mm || 0) * DOTS_PER_MM);
}

function tsplEscape(value) {
    // TSPL string literals are double-quoted; escape embedded quotes and
    // strip control characters that would break the command line.
    return String(value == null ? "" : value)
        .replace(/["\\]/g, "")
        .replace(/[\r\n]/g, " ");
}

function resolveElementValue(element, data) {
    if (Object.prototype.hasOwnProperty.call(element, "literal")) return element.literal;
    return (data && data[element.field] != null) ? data[element.field] : "";
}

function textCommand(element, data) {
    const x = mmToDots(element.x_mm);
    const y = mmToDots(element.y_mm);
    const value = tsplEscape(resolveElementValue(element, data));
    // Built-in font "3" (a mid-size bitmap font); font_size scales it via
    // the x/y multiplier args (TSPL takes integer multipliers, not a
    // point size) -- font_size 10 -> multiplier 1, roughly doubling per
    // +10, clamped to TSPL's 1-10 multiplier range.
    const mult = Math.min(10, Math.max(1, Math.round((Number(element.font_size) || 10) / 10)));
    return `TEXT ${x},${y},"3",0,${mult},${mult},"${value}"`;
}

function barcodeCommand(element, data) {
    const x = mmToDots(element.x_mm);
    const y = mmToDots(element.y_mm);
    const height = mmToDots(element.height_mm || 10);
    const value = tsplEscape(resolveElementValue(element, data));
    const type = element.barcode_type === "ean13" ? "EAN13" : "128";
    // human-readable line under the barcode (1) -- useful on a warehouse
    // floor where someone may need to read it without a scanner.
    return `BARCODE ${x},${y},"${type}",${height},1,0,2,2,"${value}"`;
}

function qrCommand(element, data) {
    const x = mmToDots(element.x_mm);
    const y = mmToDots(element.y_mm);
    const value = tsplEscape(resolveElementValue(element, data));
    // ECC level M (medium, TSPL's "M"), cell width from width_mm (a QR
    // "cell" in TSPL is specified as a dot-size integer, not mm directly
    // -- approximate via width_mm / expected module count; a flat default
    // of 4 dots/cell reads reliably at 50mm label size and is adjusted
    // per-template via width_mm if a template needs it denser/looser).
    const cellSize = Math.max(1, Math.round(mmToDots(element.width_mm || 20) / 40));
    return `QRCODE ${x},${y},M,${cellSize},A,0,"${value}"`;
}

function elementCommand(element, data) {
    if (element.type === "text") return textCommand(element, data);
    if (element.type === "barcode") return barcodeCommand(element, data);
    if (element.type === "qr") return qrCommand(element, data);
    throw new Error("print-tspl: unknown element type '" + element.type + "'");
}

function buildTsplFromTemplate(template, data) {
    const widthMm = Number(template.width_mm) || 50;
    const heightMm = Number(template.height_mm) || 50;
    const elements = Array.isArray(template.elements) ? template.elements : [];
    const lines = [
        `SIZE ${widthMm} mm,${heightMm} mm`,
        `GAP 2 mm,0 mm`,
        `CLS`,
        ...elements.map((element) => elementCommand(element, data || {})),
        `PRINT 1,1`,
    ];
    return lines.join("\r\n") + "\r\n";
}

// Plain global-scope exports (this repo has no module system) plus a
// CommonJS export so print-tspl.test.js (Node, no browser) can require it.
if (typeof module !== "undefined" && module.exports) {
    module.exports = { buildTsplFromTemplate, mmToDots, tsplEscape };
}
