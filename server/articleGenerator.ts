import OpenAI from "openai";
import { storage } from "./storage";
import { randomBytes } from "crypto";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { ArticleContextRules } from "@shared/schema";
import { generateImageBuffer } from "./replit_integrations/image/client";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface GeneratedArticle {
  title: string;
  slug: string;
  summary: string;
  content: string;
  category: string;
  tags: string[];
  metaTitle: string;
  metaDescription: string;
}

interface GenerateArticleOptions {
  topic: string;
  customPrompt?: string;
  contextRules?: ArticleContextRules | null;
}

function generateSlug(title: string): string {
  const baseSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .substring(0, 60);
  const uniqueSuffix = randomBytes(4).toString("hex");
  return `${baseSlug}-${uniqueSuffix}`;
}

const F1_TOPICS = [
  "2026 F1 season predictions and analysis",
  "F1 team performance comparisons",
  "Driver championship standings predictions",
  "Constructor championship market analysis",
  "F1 regulation changes impact on teams",
  "Upcoming race predictions and betting insights",
  "Team budget cap and development updates",
  "Driver transfers and team lineup changes",
  "Technical developments in Formula 1",
  "F1 betting strategies and market trends",
];

function buildSystemPrompt(contextRules?: ArticleContextRules | null): string {
  let basePrompt = `You are an expert Formula 1 journalist and prediction market analyst. Write engaging, informative articles that combine F1 racing insights with prediction market analysis.`;
  
  if (contextRules) {
    if (contextRules.toneOfVoice) {
      basePrompt += `\n\nTone of Voice: ${contextRules.toneOfVoice}`;
    }
    if (contextRules.writingStyle) {
      basePrompt += `\n\nWriting Style: ${contextRules.writingStyle}`;
    }
    if (contextRules.targetAudience) {
      basePrompt += `\n\nTarget Audience: ${contextRules.targetAudience}`;
    }
    if (contextRules.additionalRules) {
      basePrompt += `\n\nAdditional Guidelines: ${contextRules.additionalRules}`;
    }
  }
  
  basePrompt += `

Your articles should:
1. Be factual and well-researched about F1 teams and drivers
2. Include prediction market insights and betting angles
3. Use SEO-friendly language with relevant keywords
4. Be structured with clear sections and headers
5. Appeal to both F1 fans and prediction market traders

Current F1 teams for 2026 season: Red Bull Racing, Ferrari, Mercedes, McLaren, Aston Martin, Alpine, Williams, Haas, RB (VCARB), Kick Sauber.

Format your response as JSON with this structure:
{
  "title": "Compelling article title (50-70 chars)",
  "summary": "2-3 sentence summary for preview cards (150-200 chars)",
  "content": "Full article in markdown format with headers, paragraphs, and bullet points",
  "category": "One of: news, analysis, predictions, teams, drivers",
  "tags": ["array", "of", "relevant", "tags"],
  "metaTitle": "SEO-optimized title (max 60 chars)",
  "metaDescription": "SEO meta description (max 155 chars)"
}`;

  return basePrompt;
}

export async function generateArticleFromTopic(options: GenerateArticleOptions): Promise<GeneratedArticle> {
  const { topic, customPrompt, contextRules } = options;
  const systemPrompt = buildSystemPrompt(contextRules);
  
  const userMessage = customPrompt 
    ? `${customPrompt}\n\nTopic: ${topic}`
    : `Write an article about: ${topic}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_object" },
    max_tokens: 3000,
    temperature: 0.7,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No content generated from OpenAI");
  }

  let articleData: Record<string, unknown>;
  try {
    articleData = JSON.parse(content);
  } catch (parseError) {
    console.error("[ArticleGenerator] Failed to parse OpenAI response:", content.substring(0, 500));
    throw new Error("OpenAI returned invalid JSON format. Please try again.");
  }
  
  if (!articleData.title || typeof articleData.title !== "string") {
    throw new Error("Generated article is missing a valid title");
  }
  if (!articleData.summary || typeof articleData.summary !== "string") {
    throw new Error("Generated article is missing a valid summary");
  }
  if (!articleData.content || typeof articleData.content !== "string") {
    throw new Error("Generated article is missing valid content");
  }
  
  const slug = generateSlug(articleData.title);

  return {
    title: articleData.title,
    slug,
    summary: articleData.summary,
    content: articleData.content,
    category: typeof articleData.category === "string" ? articleData.category : "news",
    tags: Array.isArray(articleData.tags) ? articleData.tags.filter((t): t is string => typeof t === "string") : [],
    metaTitle: typeof articleData.metaTitle === "string" ? articleData.metaTitle : articleData.title.substring(0, 60),
    metaDescription: typeof articleData.metaDescription === "string" ? articleData.metaDescription : articleData.summary.substring(0, 155),
  };
}

interface GenerateAndSaveOptions {
  topic?: string;
  customPrompt?: string;
}

export async function generateAndSaveArticle(options?: GenerateAndSaveOptions): Promise<{ id: string; title: string; slug: string }> {
  const { topic, customPrompt } = options || {};
  const selectedTopic = topic || F1_TOPICS[Math.floor(Math.random() * F1_TOPICS.length)];
  
  const contextRules = await storage.getActiveContextRules();
  
  console.log(`[ArticleGenerator] Generating article for topic: ${selectedTopic}`);
  if (contextRules) {
    console.log(`[ArticleGenerator] Using context rules: ${contextRules.name}`);
  }
  
  const article = await generateArticleFromTopic({ 
    topic: selectedTopic, 
    customPrompt,
    contextRules 
  });
  
  const savedArticle = await storage.createArticle({
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    content: article.content,
    category: article.category,
    tags: article.tags,
    status: "draft",
    metaTitle: article.metaTitle,
    metaDescription: article.metaDescription,
    promptInput: customPrompt || null,
  });

  console.log(`[ArticleGenerator] Created draft article: ${savedArticle.title} (${savedArticle.id})`);
  
  const generatedImageUrl = await generateArticleImage(article.title, article.category, savedArticle.id);
  if (generatedImageUrl) {
    await storage.updateArticle(savedArticle.id, { 
      thumbnailUrl: generatedImageUrl,
      heroImageUrl: generatedImageUrl
    });
  }
  
  return {
    id: savedArticle.id,
    title: savedArticle.title,
    slug: savedArticle.slug,
  };
}

interface NewsItem {
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt?: string;
}

const F1_RSS_FEEDS = [
  { name: "Autosport", url: "https://www.autosport.com/rss/feed/f1" },
  { name: "Motorsport.com", url: "https://www.motorsport.com/rss/f1/news/" },
  { name: "PlanetF1", url: "https://www.planetf1.com/feed/" },
  { name: "RaceFans", url: "https://www.racefans.net/feed/" },
];

async function fetchRSSFeed(feedUrl: string, sourceName: string): Promise<NewsItem[]> {
  try {
    const response = await fetch(feedUrl, {
      headers: { 'User-Agent': 'F1Predict/1.0 NewsAggregator' },
      signal: AbortSignal.timeout(10000),
    });
    
    if (!response.ok) {
      console.log(`[DailyRoundup] RSS fetch failed for ${sourceName}: ${response.status}`);
      return [];
    }
    
    const xml = await response.text();
    const items: NewsItem[] = [];
    
    const itemMatches = xml.match(/<item[^>]*>[\s\S]*?<\/item>/gi) || [];
    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
    
    for (const itemXml of itemMatches.slice(0, 10)) {
      const titleMatch = itemXml.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
      const linkMatch = itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
      const descMatch = itemXml.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
      const pubDateMatch = itemXml.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
      
      if (titleMatch && linkMatch) {
        const pubDate = pubDateMatch ? new Date(pubDateMatch[1].trim()).getTime() : Date.now();
        
        if (pubDate >= twentyFourHoursAgo) {
          const title = titleMatch[1].trim().replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
          const summary = descMatch 
            ? descMatch[1].trim().replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').substring(0, 300)
            : '';
          
          items.push({
            title,
            summary,
            url: linkMatch[1].trim(),
            source: sourceName,
            publishedAt: pubDateMatch ? pubDateMatch[1].trim() : undefined,
          });
        }
      }
    }
    
    return items;
  } catch (error) {
    console.error(`[DailyRoundup] RSS error for ${sourceName}:`, error);
    return [];
  }
}

async function searchF1News(): Promise<NewsItem[]> {
  console.log("[DailyRoundup] Fetching F1 news from RSS feeds...");
  
  const allNews: NewsItem[] = [];
  
  for (const feed of F1_RSS_FEEDS) {
    try {
      const items = await fetchRSSFeed(feed.url, feed.name);
      console.log(`[DailyRoundup] Fetched ${items.length} items from ${feed.name}`);
      allNews.push(...items);
    } catch (error) {
      console.error(`[DailyRoundup] Failed to fetch ${feed.name}:`, error);
    }
  }
  
  const uniqueNews = allNews.reduce((acc, item) => {
    const exists = acc.some(existing => 
      existing.title.toLowerCase().includes(item.title.toLowerCase().substring(0, 30)) ||
      item.title.toLowerCase().includes(existing.title.toLowerCase().substring(0, 30))
    );
    if (!exists) acc.push(item);
    return acc;
  }, [] as NewsItem[]);
  
  uniqueNews.sort((a, b) => {
    if (!a.publishedAt || !b.publishedAt) return 0;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });
  
  console.log(`[DailyRoundup] Total unique news items: ${uniqueNews.length}`);
  return uniqueNews.slice(0, 10);
}

function buildRoundupSystemPrompt(contextRules?: ArticleContextRules | null): string {
  let basePrompt = `You are an expert Formula 1 journalist writing a daily news roundup. Your task is to create an engaging summary article that covers the most notable F1 news from the past 24 hours.`;
  
  if (contextRules) {
    if (contextRules.toneOfVoice) {
      basePrompt += `\n\nTone of Voice: ${contextRules.toneOfVoice}`;
    }
    if (contextRules.writingStyle) {
      basePrompt += `\n\nWriting Style: ${contextRules.writingStyle}`;
    }
    if (contextRules.targetAudience) {
      basePrompt += `\n\nTarget Audience: ${contextRules.targetAudience}`;
    }
    if (contextRules.additionalRules) {
      basePrompt += `\n\nAdditional Guidelines: ${contextRules.additionalRules}`;
    }
  }
  
  basePrompt += `

CRITICAL FORMATTING REQUIREMENTS:
1. Include inline markdown links to sources throughout the article - DO NOT use separate reference sections
2. Each news item mentioned MUST have a clickable link to its source
3. Use format: [descriptive text](url) for all source links
4. Structure the article with clear sections using markdown headers (##)
5. Make the article flow naturally while incorporating source links
6. Include at least 5 different source links throughout the article

Example of proper inline linking:
"According to [Autosport's latest report](https://autosport.com/example), Mercedes has unveiled..."

Format your response as JSON:
{
  "title": "Daily F1 Roundup: [Compelling headline] (date format: Month DD, YYYY)",
  "summary": "2-3 sentence summary highlighting the key stories",
  "content": "Full article in markdown with inline source links throughout",
  "category": "daily-roundup",
  "tags": ["array", "of", "relevant", "tags", "daily-roundup"],
  "metaTitle": "SEO-optimized title (max 60 chars)",
  "metaDescription": "SEO meta description (max 155 chars)"
}`;

  return basePrompt;
}

export async function generateDailyRoundup(): Promise<{ id: string; title: string; slug: string }> {
  console.log("[DailyRoundup] Starting daily roundup generation...");
  
  const newsItems = await searchF1News();
  if (newsItems.length === 0) {
    throw new Error("No F1 news found to summarize");
  }
  
  console.log(`[DailyRoundup] Found ${newsItems.length} news items`);
  
  const contextRules = await storage.getActiveContextRules();
  const systemPrompt = buildRoundupSystemPrompt(contextRules);
  
  const newsContext = newsItems.map((item, i) => 
    `${i + 1}. ${item.title}\n   Source: ${item.source} (${item.url})\n   Summary: ${item.summary}`
  ).join("\n\n");
  
  const today = new Date().toLocaleDateString('en-US', { 
    month: 'long', 
    day: 'numeric', 
    year: 'numeric' 
  });
  
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { 
        role: "user", 
        content: `Write a daily roundup article for ${today} based on these news items. Make sure to include clickable source links for each story mentioned:\n\n${newsContext}`
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 4000,
    temperature: 0.7,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No content generated for daily roundup");
  }

  let articleData: Record<string, unknown>;
  try {
    articleData = JSON.parse(content);
  } catch (parseError) {
    console.error("[DailyRoundup] Failed to parse response:", content.substring(0, 500));
    throw new Error("Failed to parse daily roundup article");
  }

  if (!articleData.title || !articleData.summary || !articleData.content) {
    throw new Error("Generated roundup is missing required fields");
  }

  const slug = generateSlug(articleData.title as string);

  const savedArticle = await storage.createArticle({
    slug,
    title: articleData.title as string,
    summary: articleData.summary as string,
    content: articleData.content as string,
    category: "daily-roundup",
    tags: Array.isArray(articleData.tags) ? articleData.tags.filter((t): t is string => typeof t === "string") : ["daily-roundup", "f1-news"],
    status: "draft",
    articleType: "daily-roundup",
    metaTitle: typeof articleData.metaTitle === "string" ? articleData.metaTitle : (articleData.title as string).substring(0, 60),
    metaDescription: typeof articleData.metaDescription === "string" ? articleData.metaDescription : (articleData.summary as string).substring(0, 155),
    promptInput: `Daily Roundup - ${today}`,
  });

  console.log(`[DailyRoundup] Created roundup article: ${savedArticle.title} (${savedArticle.id})`);

  const generatedImageUrl = await generateArticleImage(savedArticle.title, "daily-roundup", savedArticle.id);
  if (generatedImageUrl) {
    await storage.updateArticle(savedArticle.id, { 
      thumbnailUrl: generatedImageUrl,
      heroImageUrl: generatedImageUrl
    });
  }

  return {
    id: savedArticle.id,
    title: savedArticle.title,
    slug: savedArticle.slug,
  };
}

export async function generateMultipleArticles(count: number = 3): Promise<{ id: string; title: string; slug: string }[]> {
  const results: { id: string; title: string; slug: string }[] = [];
  
  const shuffledTopics = [...F1_TOPICS].sort(() => Math.random() - 0.5);
  const selectedTopics = shuffledTopics.slice(0, count);
  
  for (const topic of selectedTopics) {
    try {
      const result = await generateAndSaveArticle({ topic });
      results.push(result);
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`[ArticleGenerator] Failed to generate article for topic "${topic}":`, error);
    }
  }
  
  return results;
}

async function generateArticleImage(title: string, category: string, articleId: string): Promise<string | null> {
  try {
    const imageDir = join(process.cwd(), "public", "article-images");
    if (!existsSync(imageDir)) {
      mkdirSync(imageDir, { recursive: true });
    }
    
    const prompt = `Create a professional, eye-catching image for an F1 Formula 1 racing article titled "${title}". The image should be:
- Dramatic and dynamic, capturing the excitement of F1 racing
- Using red, black, and carbon fiber aesthetic common in F1 branding
- Include subtle racing elements like a track, car silhouette, or checkered patterns
- Modern, clean design suitable for a news article hero and Open Graph preview
- Category: ${category}
- No text or logos in the image
- Photorealistic style with dramatic lighting
- Landscape orientation (16:9 aspect ratio) optimized for social media sharing`;
    
    console.log(`[ArticleGenerator] Generating OG-compatible image for article: ${articleId}`);
    const imageBuffer = await generateImageBuffer(prompt, "1024x1024");
    
    const filename = `article-${articleId}.png`;
    const filepath = join(imageDir, filename);
    writeFileSync(filepath, imageBuffer);
    
    const imageUrl = `/article-images/${filename}`;
    console.log(`[ArticleGenerator] Article image saved: ${imageUrl}`);
    
    return imageUrl;
  } catch (error) {
    console.error(`[ArticleGenerator] Failed to generate article image:`, error);
    return null;
  }
}

export { F1_TOPICS };
