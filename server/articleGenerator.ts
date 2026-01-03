import OpenAI from "openai";
import { storage } from "./storage";
import { randomBytes } from "crypto";

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

export async function generateArticleFromTopic(topic: string): Promise<GeneratedArticle> {
  const systemPrompt = `You are an expert Formula 1 journalist and prediction market analyst. Write engaging, informative articles that combine F1 racing insights with prediction market analysis. Your articles should:

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

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Write an article about: ${topic}` },
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

export async function generateAndSaveArticle(topic?: string): Promise<{ id: string; title: string; slug: string }> {
  const selectedTopic = topic || F1_TOPICS[Math.floor(Math.random() * F1_TOPICS.length)];
  
  console.log(`[ArticleGenerator] Generating article for topic: ${selectedTopic}`);
  
  const article = await generateArticleFromTopic(selectedTopic);
  
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
  });

  console.log(`[ArticleGenerator] Created draft article: ${savedArticle.title} (${savedArticle.id})`);
  
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
      const result = await generateAndSaveArticle(topic);
      results.push(result);
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`[ArticleGenerator] Failed to generate article for topic "${topic}":`, error);
    }
  }
  
  return results;
}

export { F1_TOPICS };
