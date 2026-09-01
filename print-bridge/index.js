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

async function handleQueuedJob(job) {
    console.log("[print-bridge] queued job seen:", job.id, "tspl length:", (job.tspl || "").length);
    // Task 7 replaces this line with the actual TCP send + status update.
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
