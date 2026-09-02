// print-bridge/index.js — one always-on process, warehouse LAN.
// Watches print_jobs for status='queued' rows and relays their tspl text
// to the printer. Never parses or builds label content -- print-tspl.js
// (in the main repo, browser side) already did that.
"use strict";
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PRINTER_IP = process.env.PRINTER_IP;
const PRINTER_PORT = Number(process.env.PRINTER_PORT || 9100);

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !PRINTER_IP) {
    console.error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, PRINTER_IP. See .env.example.");
    process.exit(1);
}

const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const net = require("node:net");

function sendToPrinter(payloadBase64) {
    return new Promise((resolve, reject) => {
        // print_jobs.tspl is base64-wrapped bytes, not text -- print-tspl.js
        // (browser side) already did any charset encoding (CP1251 for
        // Cyrillic) and will do the same for future binary content like
        // BITMAP images. This bridge has no charset knowledge of its own:
        // decode base64, write the raw bytes, done.
        const bytes = Buffer.from(payloadBase64, "base64");
        const socket = net.createConnection({ host: PRINTER_IP, port: PRINTER_PORT }, () => {
            socket.write(bytes, () => {
                socket.end();
            });
        });
        socket.setTimeout(10000);
        socket.on("timeout", () => {
            socket.destroy();
            reject(new Error("Таймаут соединения с принтером (" + PRINTER_IP + ":" + PRINTER_PORT + ")"));
        });
        socket.on("error", (error) => {
            reject(new Error("Ошибка соединения с принтером: " + error.message));
        });
        socket.on("close", (hadError) => {
            if (!hadError) resolve();
        });
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

console.log("[print-bridge] starting, printer target:", PRINTER_IP + ":" + PRINTER_PORT);
void pollOnce(); // catch anything queued before this process started
startRealtimeSubscription();
// Safety net: Realtime can drop silently on network blips (this repo's
// own tasks.js has hit this class of issue before with WB CDN photo
// loads) -- a slow poll alongside the subscription means a queued job
// never waits forever even if the socket dies quietly.
setInterval(() => { void pollOnce(); }, 30000);
