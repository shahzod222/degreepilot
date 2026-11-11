import "dotenv/config";

import { db } from "../db/pool.ts";
import { checkPrerequisites } from "../services/prerequisites.ts";

async function main() {
  try {
    const result = await checkPrerequisites("CISC 4900", [
      "CISC 3130",
      "CISC 3140",
    ]);

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
