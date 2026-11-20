import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// The header's Theory6 Apps badge, clipped to its circle on a transparent tab icon.
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default async function Icon() {
  const logo = await readFile(join(process.cwd(), "src/assets/apps-logo-256.png"));
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      {/* biome-ignore lint/performance/noImgElement: ImageResponse renders plain img elements. */}
      <img
        alt=""
        src={`data:image/png;base64,${logo.toString("base64")}`}
        width={size.width}
        height={size.height}
        style={{ borderRadius: "50%" }}
      />
    </div>,
    size,
  );
}
