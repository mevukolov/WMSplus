// inventory-dates.test.js — run with: node inventory-dates.test.js
const assert = require("node:assert");
const { formatDateShort, addDays } = require("./inventory-dates.js");

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

test("formatDateShort converts ISO to DD.MM.YY", () => {
    assert.strictEqual(formatDateShort("2026-09-24"), "24.09.26");
});

test("formatDateShort passes through malformed input unchanged", () => {
    // NB: a hyphen-joined 3-word string like "not-a-date" is NOT a good
    // fixture here -- it happens to split into exactly 3 parts just like a
    // real ISO date would, so it doesn't exercise the guard at all. Use a
    // string with the wrong separator entirely (no "-") so parts.length is
    // actually != 3.
    assert.strictEqual(formatDateShort("2026/09/24"), "2026/09/24");
});

test("addDays advances within a month", () => {
    assert.strictEqual(addDays("2026-09-24", 1), "2026-09-25");
});

test("addDays crosses a month boundary", () => {
    assert.strictEqual(addDays("2026-09-30", 1), "2026-10-01");
});

test("addDays crosses a year boundary", () => {
    assert.strictEqual(addDays("2026-12-31", 1), "2027-01-01");
});

test("night-shift regression: date_line2 is the NEXT calendar day, formatted, not a duplicate of date_line1", () => {
    // This is the exact bug a prior review round found: a night-shift
    // box's date_line2 was wrongly duplicating date_line1 instead of
    // being the following day.
    const shiftDate = "2026-09-30"; // month-boundary case, most likely to break a naive implementation
    const dateLine1 = formatDateShort(shiftDate);
    const dateLine2 = formatDateShort(addDays(shiftDate, 1));
    assert.strictEqual(dateLine1, "30.09.26");
    assert.strictEqual(dateLine2, "01.10.26");
    assert.notStrictEqual(dateLine1, dateLine2);
});
