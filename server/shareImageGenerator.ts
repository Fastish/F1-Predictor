import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { readFileSync } from "fs";
import { join } from "path";
import type { NormalizedOutcome } from "./polymarket";

interface ShareImageData {
  marketTitle: string;
  outcomes: Array<{ name: string; price: number; image?: string }>;
  timestamp: Date;
}

// Load Inter font for Satori (TTF format required - satori doesn't support woff2)
let fontData: ArrayBuffer | null = null;

async function loadFont(): Promise<ArrayBuffer> {
  if (fontData) return fontData;
  
  // Use Inter TTF from GitHub releases (satori requires TTF or OTF, not woff2)
  const fontUrls = [
    // Inter TTF from unpkg (rsms/inter)
    "https://unpkg.com/@fontsource/inter@5.0.8/files/inter-latin-400-normal.woff",
    // Roboto TTF fallback 
    "https://github.com/googlefonts/roboto/raw/main/src/hinted/Roboto-Regular.ttf",
  ];
  
  for (const url of fontUrls) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        // Check it's not HTML (starts with < which is 0x3C)
        const firstByte = new Uint8Array(buffer)[0];
        if (firstByte !== 0x3C && buffer.byteLength > 1000) {
          fontData = buffer;
          console.log(`Loaded font from ${url}`);
          return fontData;
        }
      }
    } catch (e) {
      console.log(`Font fetch failed for ${url}`);
    }
  }
  
  throw new Error("Could not load any fonts for image generation");
}

// F1 Predict brand colors
const colors = {
  background: "#0a0a0a",
  cardBg: "#141414",
  primary: "#e10600", // F1 red
  text: "#ffffff",
  textSecondary: "#a1a1aa",
  border: "#27272a",
  barBg: "#1f1f1f",
  gradient: "linear-gradient(135deg, #e10600 0%, #ff4d4d 100%)",
};

// Embedded F1 Predict logo as base64 data URL (works in both dev and production)
const LOGO_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAZAAAABfCAYAAADGdpEZAAAAAXNSR0IArs4c6QAAARJlWElmTU0AKgAAAAgABwESAAMAAAABAAEAAAEaAAUAAAABAAAAYgEbAAUAAAABAAAAagEoAAMAAAABAAIAAAExAAIAAABqAAAAcgE7AAIAAAAMAAAA3IdpAAQAAAABAAAA6AAAAAAAAABgAAAAAQAAAGAAAAABQ2FudmEgZG9jPURBRzlsdHQyU0VBIHVzZXI9VUFHMWNMOUw0Z1EgYnJhbmQ9QkFHMWNIaXF0a0EgdGVtcGxhdGU9ZGctNjA0OWRiZDUtYzVlNy00OGM3LWI1MjItY2U2NGI4YjNmZDc0AExpZWYgU3RvcmVyAAADoAEAAwAAAAEAAQAAoAIABAAAAAEAAAGQoAMABAAAAAEAAABfAAAAAPBnGSIAAAAJcEhZcwAADsQAAA7EAZUrDhsAAAYnaVRYdFhNTDpjb20uYWRvYmUueG1wAAAAAAA8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJYTVAgQ29yZSA2LjAuMCI+CiAgIDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+CiAgICAgIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiCiAgICAgICAgICAgIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIKICAgICAgICAgICAgeG1sbnM6QXR0cmliPSJodHRwOi8vbnMuYXR0cmlidXRpb24uY29tL2Fkcy8xLjAvIgogICAgICAgICAgICB4bWxuczpDb250YWluc0FpR2VuZXJhdGVkQ29udGVudD0iaHR0cHM6Ly9jYW52YS5jb20vZXhwb3J0IgogICAgICAgICAgICB4bWxuczp0aWZmPSJodHRwOi8vbnMuYWRvYmUuY29tL3RpZmYvMS4wLyIKICAgICAgICAgICAgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIj4KICAgICAgICAgPGRjOmNyZWF0b3I+CiAgICAgICAgICAgIDxyZGY6U2VxPgogICAgICAgICAgICAgICA8cmRmOmxpPkxpZWYgU3RvcmVyPC9yZGY6bGk+CiAgICAgICAgICAgIDwvcmRmOlNlcT4KICAgICAgICAgPC9kYzpjcmVhdG9yPgogICAgICAgICA8ZGM6dGl0bGU+CiAgICAgICAgICAgIDxyZGY6QWx0PgogICAgICAgICAgICAgICA8cmRmOmxpIHhtbDpsYW5nPSJ4LWRlZmF1bHQiPlByZWRpY3QgLSAxPC9yZGY6bGk+CiAgICAgICAgICAgIDwvcmRmOkFsdD4KICAgICAgICAgPC9kYzp0aXRsZT4KICAgICAgICAgPEF0dHJpYjpBZHM+CiAgICAgICAgICAgIDxyZGY6U2VxPgogICAgICAgICAgICAgICA8cmRmOmxpIHJkZjpwYXJzZVR5cGU9IlJlc291cmNlIj4KICAgICAgICAgICAgICAgICAgPEF0dHJpYjpUb3VjaFR5cGU+MjwvQXR0cmliOlRvdWNoVHlwZT4KICAgICAgICAgICAgICAgICAgPEF0dHJpYjpDcmVhdGVkPjIwMjYtMDEtMDU8L0F0dHJpYjpDcmVhdGVkPgogICAgICAgICAgICAgICAgICA8QXR0cmliOkV4dElkPmY2ZDdhNDA5LWZjOGEtNDJmOC1iZGY2LWRkZjUxMjcyMWI1MzwvQXR0cmliOkV4dElkPgogICAgICAgICAgICAgICAgICA8QXR0cmliOkZiSWQ+NTI1MjY1OTE0MTc5NTgwPC9BdHRyaWI6RmJJZD4KICAgICAgICAgICAgICAgPC9yZGY6bGk+CiAgICAgICAgICAgIDwvcmRmOlNlcT4KICAgICAgICAgPC9BdHRyaWI6QWRzPgogICAgICAgICA8Q29udGFpbnNBaUdlbmVyYXRlZENvbnRlbnQ6Q29udGFpbnNBaUdlbmVyYXRlZENvbnRlbnQ+WWVzPC9Db250YWluc0FpR2VuZXJhdGVkQ29udGVudDpDb250YWluc0FpR2VuZXJhdGVkQ29udGVudD4KICAgICAgICAgPHRpZmY6T3JpZW50YXRpb24+MTwvdGlmZjpPcmllbnRhdGlvbj4KICAgICAgICAgPHhtcDpDcmVhdG9yVG9vbD5DYW52YSBkb2M9REFHOWx0dDJTRUEgdXNlcj1VQUcxY0w5TDRnUSBicmFuZD1CQUcxY0hpcXRrQSB0ZW1wbGF0ZT1kZy02MDQ5ZGJkNS1jNWU3LTQ4YzctYjUyMi1jZTY0YjhiM2ZkNzQ8L3htcDpDcmVhdG9yVG9vbD4KICAgICAgPC9yZGY6RGVzY3JpcHRpb24+CiAgIDwvcmRmOlJERj4KPC94OnhtcG1ldGE+CvajrDMAAB8aSURBVHgB7Z0JnBxVncd/VV09c8zM5CaETAgJEMJlDIICEnFBEQRRUVH0s4p4oeuKKC4qoKuiq7gqKiLy+eBBFC8UxSUiLAgIuEQJR0JIyE0mV+aYo7uqa9/3X9XVPd09PZmQo2f6f//v63r1rv7Xq1fv/M9qK6MlDYEJpCGQhmAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkITCCNgTCkITCBNAamkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpCEwgjYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkITCCNgTCkITCBNAbCkIbABNIYCEMaAhNIYyAMaQhMII2BMKQhMIE0BsKQhsAE0hgIQxoCE0hjIAxpCEwgjYEwpCEwgTQGwpCGwATSGAhDGgITSGMgDGkITCCNgTCkITCBNAbCkIbABNIYCEMaAhNIYyAMaQhMII2BMKQhMIE0BsKQhsAE0hgIQxoCE0hjIAxpCEwgjYEwpCEwgTQGwpCGwATSGAhDGgITSGNgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEEhjYAxhSENgCmMaAmkIhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEEhjIAxpCIQhDYE0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEEhjIAxpCIQhDYE0BCaQxkAY0hBIYyAMaQiEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hBIYyAMaQiEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQSGMgDGkIhCENgTQEJpDGQBjSEEhjIAxpCIQhDYE0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDIJXABNIYCEMaAmkITCCNgTCkIZDGQBjSEAhDGgJpCEwgjYEwpCEwgTQGwpCGQBoCE0hjIAxpCEwgjYEwpCEwgTQGwpCGQBoCE0hjIAxpCEwgjYEwpCEwgTQGwpCGQBoDYUhDYAJpDIQhDYE0BsKQhkAY0hBIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQSGMgDGkIhCENgTQEJpDGQBjSEEhjIAxpCIQhDYE0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hBIYyAMaQiEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgTQGwpCGQBjSEEhjIAxpCIQhDYE0BCaQxkAY0hCYQBoDYUhDIJXABNIYCEMaAmkITCCNgTCkIZDGQBjSEAhDGgITSGMgDGkITCCNgTCkIZDGQBjSEAhDGgITSGMgDGkITCCNgTCkIZDGQBjSEAhDGgITSGMgDGkIpDEQhjQEwpCGQBoDYUhDIAyBNAQmkMZAGNIQSGMgDGkIhCENgTQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgTQGwpCGQBjSEEhjIAxpCIQhDYE0BCaQxkAY0hBIYyAMaQiEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQSGMgDGkIhCENgTQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDIJXABNIYCEMaAmkITCCNgTCkIZDGQBjSEAhDGgJpCEwgjYEwpCEwgTQGwpCGQBoDYUhDIAyBNAQmkMZAGNIQSGMgDGkIhCENgTQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEEhjYAxhSENgCmMaAmkIhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEEhjIAxpCIQhDYE0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEEhjIAxpCIQhDYE0BCaQxkAY0hBIYyAMaQiEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQSGMgDGkIhCENgTQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgTQGwpCGQBjSEEhjIAxpCIQhDYE0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgTQGwpCGQBjSEEhjIAxpCIQhDYE0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQSGMgDGkIhCENgTQEJpDGQBjSEEhjIAxpCIQhDYE0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQSGMgDGkIhCENgTQEJpDGQBjSEEhjIAxpCIQhDYE0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQSGMgDGkIhCENgTQEJpDGQBjSEEhjIAxpCIQhDYE0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQSGMgDGkIhCENgTQEJpDGQBjSEEhjIAxpCIQhDYE0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDIJXABNIYCEMaAmkITCCNgTCkIZDGQBjSEAhDGgITSGMgDGkITCCNgTCkIZDGQBjSEAhDGgITSGMgDGkITCCNgTCkIZDGQBjSEAhDGgITSGMgDGkIpDEQhjQEwpCGQBoDYUhDIAyBNAQmkMZAGNIQSGMgDGkIhCENgTQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQSGMgDGkIhCENgTQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgTQGwpCGQBjSEEhjIAxpCIQhDYE0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDIJXABNIYCEMaAmkITCCNgTCkIZDGQBjSEAhDGgJpCEwgjYEwpCEwgTQGwpCGQBoCE0hjIAxpCEwgjYEwpCEQhjQE0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDIJXABNIYCEMaAmkITCCNgTCkIZDGQBjSEAhDGgITSGMgDGkITCCNgTCkIZDGQBjSEAhDGgITSGMgDGkITCCNgTCkIZDGQBjSEAhDGgITSGMgDGkIpDEQhjQEwpCGQBoDYUhDIAyBNAQmkMZAGNIQSGMgDGkIhCENgTQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQSGMgDGkIhCENgTQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgTQGwpCGQBjSEEhjIAxpCIQhDYE0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDIJXABNIYCEMaAmkITCCNgTCkIZDGQBjSEAhDGgITSGMgDGkITCCNgTCkIZDGQBjSEAhDGgITSGMgDGkITCCNgTCkIZDGQBjSEAhDGgITSGMgDGkIpDEQhjQEwpCGQBoDYUhDIAyBNAQmkMZAGNIQSGMgDGkIhCENgTQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgTQGwpCGQBjSEEhjIAxpCIQhDYE0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDIJXABNIYCEMaAmkITCCNgTCkIZDGQBjSEAhDGgITSGMgDGkITCCNgTCkIZDGQBjSEAhDGgITSGMgDGkITCCNgTCkIZDGQBjSEAhDGgITSGMgDGkIpDEQhjQEwpCGQBoDYUhDIAyBNAQmkMZAGNIQSGMgDGkIhCENgTQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNAQmkMZAGNIQmEAaA2FIQ2ACaQyEIQ2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDYAJpDIQhDYEJpDEQhjQEJpDGQBjSEJhAGgNhSENgAmkMhCENgQmkMRCGNATSGAhDGgJhSEMgDYEJpDEQhjQE0hgIQxoCYUhDIA2BCaQxEIY0BCaQxkAY0hCYQBoDYUhDIJXABNIYCEMaAmkITCCNgTCkIZDGQBjSEAhDGgJpCEwgjYEwpCGwg/8Pm1D0K0iK6CEAAAAASUVORK5CYII=";

async function loadLogo(): Promise<string> {
  return LOGO_BASE64;
}

export async function generateShareImage(data: ShareImageData): Promise<Buffer> {
  const font = await loadFont();
  const logoDataUrl = await loadLogo();
  
  // Get top 5 outcomes sorted by price (highest first)
  const topOutcomes = [...data.outcomes]
    .sort((a, b) => b.price - a.price)
    .slice(0, 5);

  // Create the image using Satori (JSX-like syntax)
  // Using 'as any' because Satori accepts a virtual DOM format
  const svg = await satori(
    ({
      type: "div",
      props: {
        style: {
          width: "1600px",
          height: "900px",
          display: "flex",
          flexDirection: "column",
          backgroundColor: colors.background,
          padding: "60px",
          fontFamily: "Inter",
        },
        children: [
          // Header with logo placeholder and title
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: "40px",
              },
              children: [
                // Left side - Title
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      flexDirection: "column",
                      flex: 1,
                    },
                    children: [
                      {
                        type: "div",
                        props: {
                          style: {
                            fontSize: "48px",
                            fontWeight: "700",
                            color: colors.text,
                            lineHeight: 1.2,
                            maxWidth: "900px",
                          },
                          children: data.marketTitle,
                        },
                      },
                      {
                        type: "div",
                        props: {
                          style: {
                            fontSize: "24px",
                            color: colors.textSecondary,
                            marginTop: "16px",
                          },
                          children: `Updated ${data.timestamp.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
                        },
                      },
                    ],
                  },
                },
                // Right side - Logo image
                ...(logoDataUrl ? [{
                  type: "img",
                  props: {
                    src: logoDataUrl,
                    width: 240,
                    height: 60,
                    style: {
                      height: "60px",
                      width: "240px",
                      objectFit: "contain",
                    },
                  },
                }] : []),
              ],
            },
          },
          // Outcomes list
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: "20px",
                flex: 1,
              },
              children: topOutcomes.map((outcome, index) => ({
                type: "div",
                props: {
                  key: index,
                  style: {
                    display: "flex",
                    alignItems: "center",
                    backgroundColor: colors.cardBg,
                    borderRadius: "16px",
                    padding: "24px 32px",
                    border: `1px solid ${colors.border}`,
                  },
                  children: [
                    // Rank
                    {
                      type: "div",
                      props: {
                        style: {
                          fontSize: "28px",
                          fontWeight: "700",
                          color: index === 0 ? colors.primary : colors.textSecondary,
                          width: "60px",
                        },
                        children: `#${index + 1}`,
                      },
                    },
                    // Name
                    {
                      type: "div",
                      props: {
                        style: {
                          fontSize: "32px",
                          fontWeight: "600",
                          color: colors.text,
                          flex: 1,
                        },
                        children: outcome.name,
                      },
                    },
                    // Probability bar
                    {
                      type: "div",
                      props: {
                        style: {
                          display: "flex",
                          alignItems: "center",
                          gap: "20px",
                          width: "400px",
                        },
                        children: [
                          {
                            type: "div",
                            props: {
                              style: {
                                flex: 1,
                                height: "24px",
                                backgroundColor: colors.barBg,
                                borderRadius: "12px",
                                overflow: "hidden",
                                display: "flex",
                              },
                              children: {
                                type: "div",
                                props: {
                                  style: {
                                    width: `${Math.round(outcome.price * 100)}%`,
                                    height: "100%",
                                    backgroundColor: colors.primary,
                                    borderRadius: "12px",
                                  },
                                },
                              },
                            },
                          },
                          {
                            type: "div",
                            props: {
                              style: {
                                fontSize: "32px",
                                fontWeight: "700",
                                color: colors.text,
                                width: "100px",
                                textAlign: "right",
                              },
                              children: `${Math.round(outcome.price * 100)}%`,
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              })),
            },
          },
          // Footer
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "auto",
                paddingTop: "30px",
                borderTop: `1px solid ${colors.border}`,
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      fontSize: "20px",
                      color: colors.textSecondary,
                    },
                    children: "f1predict.replit.app",
                  },
                },
                {
                  type: "div",
                  props: {
                    style: {
                      fontSize: "20px",
                      color: colors.textSecondary,
                    },
                    children: "Powered by Polymarket",
                  },
                },
              ],
            },
          },
        ],
      },
    }) as any,
    {
      width: 1600,
      height: 900,
      fonts: [
        {
          name: "Inter",
          data: font,
          weight: 400,
          style: "normal",
        },
      ],
    }
  );

  // Convert SVG to PNG
  const resvg = new Resvg(svg, {
    background: colors.background,
    fitTo: {
      mode: "width",
      value: 1600,
    },
  });
  
  const pngData = resvg.render();
  return pngData.asPng();
}

// Cache for generated images (keyed by market slug + data hash)
const imageCache = new Map<string, { buffer: Buffer; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function generateCachedShareImage(
  slug: string,
  marketTitle: string,
  outcomes: Array<{ name: string; price: number }>
): Promise<Buffer> {
  // Create a simple hash of the data for cache key
  const dataHash = JSON.stringify(outcomes.map(o => ({ n: o.name, p: Math.round(o.price * 100) })));
  const cacheKey = `${slug}:${dataHash}`;
  
  const cached = imageCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.buffer;
  }
  
  const buffer = await generateShareImage({
    marketTitle,
    outcomes,
    timestamp: new Date(),
  });
  
  imageCache.set(cacheKey, { buffer, timestamp: Date.now() });
  
  // Clean old cache entries
  const entries = Array.from(imageCache.entries());
  for (const [key, value] of entries) {
    if (Date.now() - value.timestamp > CACHE_TTL) {
      imageCache.delete(key);
    }
  }
  
  return buffer;
}
