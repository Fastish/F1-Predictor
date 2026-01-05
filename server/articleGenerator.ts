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
