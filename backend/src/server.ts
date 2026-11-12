import "dotenv/config";
import { app } from "./app";
import { getRuntimeConfig } from "./lib/config";

const { port } = getRuntimeConfig();
app.listen(port, "0.0.0.0", () => console.log(`InvoiceGuard API listening on http://localhost:${port}`));
