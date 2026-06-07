import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const { error: testError } = await supabase
  .from("hydrants")
  .update({ municipality: "TEST" })
  .limit(1);

console.log(testError);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function extractMunicipality(address) {
  return (
    address.municipality ||
    address.city ||
    address.town ||
    address.village ||
    address.suburb ||
    address.city_district ||
    address.county ||
    null
  );
}

async function reverseGeocode(lat, lng) {
  const url =
    `https://nominatim.openstreetmap.org/reverse` +
    `?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&accept-language=el`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "HydrantsNearby municipality fill script",
    },
  });

  if (!response.ok) {
    throw new Error(`Nominatim error: ${response.status}`);
  }

  const json = await response.json();
  return extractMunicipality(json.address || {});
}

async function main() {
  const { data: hydrants, error } = await supabase
    .from("hydrants")
    .select("id, lat, lng, municipality")
    .is("municipality", null);

  if (error) {
    console.error(error);
    process.exit(1);
  }

  console.log(`Found ${hydrants.length} hydrants without municipality.`);

  for (const hydrant of hydrants) {
    try {
      console.log(`Checking ${hydrant.id} (${hydrant.lat}, ${hydrant.lng})`);

      const municipality = await reverseGeocode(hydrant.lat, hydrant.lng);

      if (!municipality) {
        console.log("  -> No municipality found");
      } else {
        console.log(`  -> ${municipality}`);

        const { error: updateError } = await supabase
          .from("hydrants")
          .update({ municipality })
          .eq("id", hydrant.id);

        if (updateError) {
          console.error("  -> Update failed:", updateError.message);
        }
      }

      await sleep(1100);
    } catch (err) {
      console.error("  -> Failed:", err.message);
      await sleep(1500);
    }
  }

  console.log("Done.");
}

main();