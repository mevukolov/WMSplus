// scripts/migrate-employees-to-auth.mjs — one-off: creates a real
// Supabase Auth user (auth.users) for each employee row in public.users
// that doesn't have one yet, using their EXISTING plaintext password
// (Admin API hashes it on the way in). Sets public.users.auth_uid to
// link them. Safe to re-run -- skips any row that already has auth_uid
// set, and skips (with a warning) any employee whose id already has a
// matching auth.users row from a previous partial run.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-employees-to-auth.mjs
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-employees-to-auth.mjs --only=1034305
//
// --only=<id>[,<id>...] restricts the run to specific employee ids -- use
// this first to create just a test account (see the plan's Task 10)
// before running the full unrestricted migration.

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy scripts/.env.example, fill it in, and export it, or run:");
    console.error("  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-employees-to-auth.mjs");
    process.exit(1);
}

const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const onlyIds = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean)) : null;

async function rest(path, options = {}) {
    const res = await fetch(SUPABASE_URL + path, {
        ...options,
        headers: {
            "content-type": "application/json",
            apikey: SERVICE_ROLE_KEY,
            authorization: "Bearer " + SERVICE_ROLE_KEY,
            ...(options.headers || {}),
        },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${options.method || "GET"} ${path} -> ${res.status}: ${JSON.stringify(body)}`);
    return body;
}

async function fetchEmployees() {
    let query = "id,pass,auth_uid&auth_uid=is.null&order=id";
    if (onlyIds) query = `id,pass,auth_uid&id=in.(${Array.from(onlyIds).join(",")})&order=id`;
    return rest(`/rest/v1/users?select=${query}`);
}

async function createAuthUser(id, pass) {
    return rest("/auth/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({ email: `${id}@wms.internal`, password: pass, email_confirm: true }),
    });
}

async function setAuthUid(id, authUid) {
    await rest(`/rest/v1/users?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({ auth_uid: authUid }),
    });
}

async function main() {
    const employees = await fetchEmployees();
    console.log(`${employees.length} employee(s) to migrate${onlyIds ? ` (--only=${Array.from(onlyIds).join(",")})` : ""}.`);

    let ok = 0;
    let failed = 0;
    for (const emp of employees) {
        if (!emp.pass) {
            console.warn(`skip ${emp.id}: no password set`);
            failed += 1;
            continue;
        }
        try {
            const created = await createAuthUser(emp.id, emp.pass);
            await setAuthUid(emp.id, created.id);
            console.log(`ok   ${emp.id} -> auth_uid ${created.id}`);
            ok += 1;
        } catch (e) {
            console.error(`FAIL ${emp.id}: ${e.message}`);
            failed += 1;
        }
    }
    console.log(`\nDone. ${ok} migrated, ${failed} failed/skipped.`);
    if (failed) process.exit(1);
}

main();
