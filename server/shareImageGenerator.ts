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

// Load Inter font for Satori (bundled with satori)
let fontData: ArrayBuffer | null = null;

async function loadFont(): Promise<ArrayBuffer> {
  if (fontData) return fontData;
  
  // Use a built-in font from Google Fonts CDN
  const response = await fetch(
    "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff"
  );
  fontData = await response.arrayBuffer();
  return fontData;
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

export async function generateShareImage(data: ShareImageData): Promise<Buffer> {
  const font = await loadFont();
  
  // Get top 5 outcomes sorted by price (highest first)
  const topOutcomes = [...data.outcomes]
    .sort((a, b) => b.price - a.price)
    .slice(0, 5);

  // Create the image using Satori (JSX-like syntax)
  const svg = await satori(
    {
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
                // Right side - Logo text
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                    },
                    children: [
                      {
                        type: "div",
                        props: {
                          style: {
                            fontSize: "36px",
                            fontWeight: "700",
                            color: colors.primary,
                          },
                          children: "F1",
                        },
                      },
                      {
                        type: "div",
                        props: {
                          style: {
                            fontSize: "36px",
                            fontWeight: "700",
                            color: colors.text,
                          },
                          children: "PREDICT",
                        },
                      },
                    ],
                  },
                },
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
                              },
                              children: [
                                {
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
                              ],
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
    },
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
  for (const [key, value] of imageCache.entries()) {
    if (Date.now() - value.timestamp > CACHE_TTL) {
      imageCache.delete(key);
    }
  }
  
  return buffer;
}
