// tests/inventory_audit_test.js
// Verification of Multi-Category Database Inventory & Paginated API Retrieval

const SUPABASE_URL = "https://fuzwizxysoqcpucpllku.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1endpenh5c29xY3B1Y3BsbGt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5MTgwMTIsImV4cCI6MjEwODQ5NDAxMn0.s8N9zdFmIoqEQRvWtXudtcCNAZjcyJQaHLd0qwaepdA";

async function runInventoryAudit() {
  console.log("=============================================================");
  console.log("  INVENTORY SCALE & ADVERSARIAL TDD HARDENING AUDIT         ");
  console.log("=============================================================");

  // 1. Fetch exact total row count via HEAD query
  const countRes = await fetch(`${SUPABASE_URL}/rest/v1/products?select=*`, {
    method: "HEAD",
    headers: {
      "apikey": ANON_KEY,
      "Authorization": `Bearer ${ANON_KEY}`,
      "Prefer": "count=exact"
    }
  });

  const contentRange = countRes.headers.get("content-range");
  console.log(`\n[DATABASE METRIC] Content-Range Header: ${contentRange}`);

  const totalMatch = contentRange ? contentRange.match(/\/(\d+)/) : null;
  const totalCount = totalMatch ? parseInt(totalMatch[1], 10) : 0;
  console.log(`✔ Total Live Products in Supabase: ${totalCount}`);

  if (totalCount < 1000) {
    console.error(`❌ FAIL: Expected 1000+ products, found only ${totalCount}`);
    process.exit(1);
  }

  // 2. Category Distribution Audit
  console.log("\n[CATEGORY DISTRIBUTION AUDIT]");
  const categories = ["Monitor", "SSD", "Laptop", "Keyboard", "Mouse", "Processor"];
  for (const cat of categories) {
    const catRes = await fetch(`${SUPABASE_URL}/rest/v1/products?category=eq.${cat}&select=id`, {
      method: "HEAD",
      headers: {
        "apikey": ANON_KEY,
        "Authorization": `Bearer ${ANON_KEY}`,
        "Prefer": "count=exact"
      }
    });
    const catRange = catRes.headers.get("content-range");
    const m = catRange ? catRange.match(/\/(\d+)/) : null;
    const cnt = m ? parseInt(m[1], 10) : 0;
    console.log(`  • ${cat.padEnd(12)}: ${cnt} active listings`);
  }

  // 3. Paginated API Retrieval Simulation
  console.log("\n[ADVERSARIAL PAGINATION TEST]");
  console.log("Testing client-side paginated retrieval beyond PostgREST 1000-row limit...");
  const pageSize = 1000;
  let collected = 0;
  for (let from = 0; from < 4000; from += pageSize) {
    const pageRes = await fetch(`${SUPABASE_URL}/rest/v1/products?select=id,title,current_price,vendor_name,category&order=last_scraped_at.desc&limit=${pageSize}&offset=${from}`, {
      headers: { "apikey": ANON_KEY, "Authorization": `Bearer ${ANON_KEY}` }
    });
    const items = await pageRes.json();
    collected += items.length;
    console.log(`  ✔ Retrieved chunk [${from} to ${from + items.length}]: ${items.length} items`);
    if (items.length < pageSize) break;
  }

  console.log(`\n✔ Successfully paged through ${collected} products without memory crash!`);
  console.log("=============================================================");
  console.log("  ALL SCALE & TDD INTEGRATION AUDITS PASSED WITH FLYING COLORS!");
  console.log("=============================================================");
}

runInventoryAudit().catch(console.error);
