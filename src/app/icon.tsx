import { ImageResponse } from "next/og";

/**
 * Tab / home-screen icon, generated at build time.
 *
 * Dark rounded square with an «Е» and two amber indicator dots — the same
 * construction as the header logo, at favicon scale. The dots are drawn rather
 * than typed, which keeps the mark legible at 16px where a serif «Ё» turns to
 * mush.
 */

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0d1014",
          borderRadius: 14,
        }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            paddingTop: 12,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              display: "flex",
              gap: 6,
            }}
          >
            <div style={{ width: 7, height: 7, borderRadius: 4, background: "#f59e0b" }} />
            <div style={{ width: 7, height: 7, borderRadius: 4, background: "#f59e0b" }} />
          </div>
          <div
            style={{
              fontFamily: "sans-serif",
              fontSize: 42,
              fontWeight: 800,
              lineHeight: 1,
              color: "#e8590c",
              letterSpacing: -2,
            }}
          >
            Е
          </div>
        </div>
      </div>
    ),
    size,
  );
}
