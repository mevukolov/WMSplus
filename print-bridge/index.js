// print-bridge/index.js — one always-on process, on a Windows 10 PC with
// the thermal printer attached via USB (no network/IP involved). Watches
// print_jobs for status='queued' rows and relays their tspl bytes to the
// printer. Never parses or builds label content -- print-tspl.js (in the
// main repo, browser side) already did that.
"use strict";
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PRINTER_NAME = process.env.PRINTER_NAME;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !PRINTER_NAME) {
    console.error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, PRINTER_NAME. See .env.example.");
    process.exit(1);
}

const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");

const SEND_RAW_SCRIPT = path.join(__dirname, "send-raw.ps1");

// USB printers have no socket to write to -- Windows only exposes them as
// an installed printer object. send-raw.ps1 pushes the bytes through the
// Print Spooler's RAW datatype (winspool.drv), which passes them through
// untouched regardless of driver, the same way the old TCP:9100 write did.
function sendToPrinter(payloadBase64) {
    return new Promise((resolve, reject) => {
        // print_jobs.tspl is base64-wrapped bytes, not text -- print-tspl.js
        // (browser side) already did any charset encoding (CP1251 for
        // Cyrillic) and will do the same for future binary content like
        // BITMAP images. This bridge has no charset knowledge of its own:
        // decode base64, write the raw bytes, done.
        const bytes = Buffer.from(payloadBase64, "base64");
        const tempFile = path.join(os.tmpdir(), "wmsplus-print-" + crypto.randomUUID() + ".bin");
        fs.writeFile(tempFile, bytes)
            .then(() => {
                execFile(
                    "powershell",
                    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SEND_RAW_SCRIPT, "-PrinterName", PRINTER_NAME, "-FilePath", tempFile],
                    { timeout: 15000 },
                    (error, stdout, stderr) => {
                        void fs.unlink(tempFile).catch(() => {}); // best-effort cleanup, doesn't affect print result
                        if (error) {
                            reject(new Error("Ошибка печати через " + PRINTER_NAME + ": " + (stderr || error.message).trim()));
                        } else {
                            resolve();
                        }
                    }
                );
            })
            .catch((error) => reject(new Error("Не удалось записать временный файл: " + error.message)));
    });
}

async function handleQueuedJob(job) {
    console.log("[print-bridge] printing job:", job.id);
    try {
        await sendToPrinter(job.tspl);
        const { error } = await client
            .from("print_jobs")
            .update({ status: "printed", printed_at: new Date().toISOString() })
            .eq("id", job.id)
            .eq("status", "queued"); // avoid double-printing if both the realtime handler and the poll loop see the same job
        if (error) console.error("[print-bridge] failed to mark job printed:", job.id, error.message);
        else console.log("[print-bridge] job printed:", job.id);
    } catch (error) {
        console.error("[print-bridge] print failed:", job.id, error.message);
        await client
            .from("print_jobs")
            .update({ status: "failed", error_message: error.message })
            .eq("id", job.id)
            .eq("status", "queued");
    }
}

async function pollOnce() {
    const { data, error } = await client
        .from("print_jobs")
        .select("id,tspl")
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(10);
    if (error) {
        console.error("[print-bridge] poll failed:", error.message);
        return;
    }
    for (const job of data || []) {
        await handleQueuedJob(job);
    }
}

function startRealtimeSubscription() {
    client
        .channel("print_jobs_queue")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "print_jobs", filter: "status=eq.queued" }, (payload) => {
            void handleQueuedJob(payload.new);
        })
        .subscribe((status) => {
            console.log("[print-bridge] realtime subscription status:", status);
        });
}

console.log("[print-bridge] starting, printer target:", PRINTER_NAME);
void pollOnce(); // catch anything queued before this process started
startRealtimeSubscription();
// Safety net: Realtime can drop silently on network blips (this repo's
// own tasks.js has hit this class of issue before with WB CDN photo
// loads) -- a slow poll alongside the subscription means a queued job
// never waits forever even if the socket dies quietly.
setInterval(() => { void pollOnce(); }, 30000);
