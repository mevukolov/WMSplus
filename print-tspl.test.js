// print-tspl.test.js — run with: node print-tspl.test.js
const assert = require("node:assert");
const { buildTsplFromTemplate, mmToDots, tsplEscape } = require("./print-tspl.js");

function test(name, fn) {
    try {
        fn();
        console.log("PASS " + name);
    } catch (error) {
        console.error("FAIL " + name);
        console.error(error);
        process.exitCode = 1;
    }
}

test("mmToDots converts using 203dpi", () => {
    assert.strictEqual(mmToDots(25.4), 203);
    assert.strictEqual(mmToDots(0), 0);
});

test("tsplEscape strips quotes and newlines", () => {
    assert.strictEqual(tsplEscape('a"b\\c'), "abc");
    assert.strictEqual(tsplEscape("line1\nline2"), "line1 line2");
    assert.strictEqual(tsplEscape(null), "");
});

test("buildTsplFromTemplate emits SIZE/GAP/CLS/PRINT around elements", () => {
    const template = {
        width_mm: 50,
        height_mm: 50,
        elements: [
            { type: "text", field: "title", x_mm: 5, y_mm: 5, font_size: 10 },
        ],
    };
    const tspl = buildTsplFromTemplate(template, { title: "Тест" });
    assert.ok(tspl.startsWith("SIZE 50 mm,50 mm\r\nGAP 2 mm,0 mm\r\nCLS\r\nDIRECTION 1\r\n"));
    assert.ok(tspl.includes('TEXT 40,40,"3",0,1,1,"Тест"'));
    assert.ok(tspl.trim().endsWith("PRINT 1,1"));
});

test("buildTsplFromTemplate resolves literal text over a missing field", () => {
    const template = { width_mm: 50, height_mm: 50, elements: [{ type: "text", literal: "СКЛАД", x_mm: 0, y_mm: 0 }] };
    const tspl = buildTsplFromTemplate(template, {});
    assert.ok(tspl.includes('"СКЛАД"'));
});

test("buildTsplFromTemplate emits a BARCODE command for type=barcode", () => {
    const template = { width_mm: 50, height_mm: 50, elements: [{ type: "barcode", field: "shk", x_mm: 5, y_mm: 5, height_mm: 10 }] };
    const tspl = buildTsplFromTemplate(template, { shk: "56515623488" });
    assert.ok(tspl.includes('BARCODE 40,40,"128",80,1,0,2,2,"56515623488"'));
});

test("buildTsplFromTemplate emits a QRCODE command for type=qr", () => {
    const template = { width_mm: 50, height_mm: 50, elements: [{ type: "qr", field: "url", x_mm: 5, y_mm: 5, width_mm: 20 }] };
    const tspl = buildTsplFromTemplate(template, { url: "https://example.com" });
    assert.ok(tspl.includes('QRCODE 40,40,M,4,A,0,"https://example.com"'));
});

test("buildTsplFromTemplate throws on an unknown element type", () => {
    const template = { width_mm: 50, height_mm: 50, elements: [{ type: "bogus", x_mm: 0, y_mm: 0 }] };
    assert.throws(() => buildTsplFromTemplate(template, {}), /unknown element type/);
});

if (process.exitCode) {
    console.error("Some tests failed.");
} else {
    console.log("All print-tspl.js tests passed.");
}
