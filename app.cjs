// Startup file for Node.js hosting panels that accept a CommonJS entry point.
// The application root must be outside public_html / httpdocs. Configure the
// panel's environment, build the frontend and limit embedded DB mode to one
// process before starting this file. Actual Passenger integration is host-specific.
process.chdir(__dirname);
require("tsx/esm/api").register();
import("./server/index.ts").catch(() => {
  console.error(
    "Agro portal nije pokrenut. Proverite privatni serverski log i konfiguraciju.",
  );
  process.exit(1);
});
