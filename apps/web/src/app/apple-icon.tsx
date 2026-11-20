import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Home-screen icon: the full square badge, since iOS applies its own rounded mask.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  const logo = await readFile(join(process.cwd(), "src/assets/apps-logo-256.png"));
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      {/* biome-ignore lint/performance/noImgElement: ImageResponse renders plain img elements. */}
      <img
        alt=""
        src={`data:image/png;base64,${logo.toString("base64")}`}
        width={size.width}
        height={size.height}
      />
    </div>,
    size,
  );
}
