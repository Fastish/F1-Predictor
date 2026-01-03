import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Header } from "@/components/Header";
import { useSEO } from "@/hooks/useSEO";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, ArrowLeft, Clock, Share2 } from "lucide-react";
import { format } from "date-fns";
import type { Article } from "@shared/schema";

export default function NewsArticle() {
  const { slug } = useParams<{ slug: string }>();

  const { data: article, isLoading, error } = useQuery<Article>({
    queryKey: ["/api/articles/slug", slug],
    queryFn: async () => {
      const res = await fetch(`/api/articles/slug/${slug}`);
      if (!res.ok) throw new Error("Article not found");
      return res.json();
    },
    enabled: !!slug,
  });

  useSEO({
    title: article?.metaTitle || article?.title || "Article",
    description: article?.metaDescription || article?.summary || "F1 news and analysis"
  });

  const estimatedReadTime = article ? Math.ceil(article.content.split(/\s+/).length / 200) : 0;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="mx-auto max-w-4xl px-4 py-8">
          <Skeleton className="h-8 w-32 mb-6" />
          <Skeleton className="h-12 w-full mb-4" />
          <Skeleton className="h-6 w-2/3 mb-8" />
          <Skeleton className="h-64 w-full mb-8" />
          <div className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </main>
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="mx-auto max-w-4xl px-4 py-8">
          <Card className="py-12">
            <CardContent className="text-center">
              <h2 className="text-2xl font-bold mb-4">Article Not Found</h2>
              <p className="text-muted-foreground mb-6">
                The article you're looking for doesn't exist or has been removed.
              </p>
              <Link href="/news">
                <Button>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to News
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Link href="/news">
          <Button variant="ghost" className="mb-6" data-testid="button-back-to-news">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to News
          </Button>
        </Link>

        <article className="prose prose-lg dark:prose-invert max-w-none" data-testid="article-content">
          <header className="not-prose mb-8">
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              {article.category && (
                <Badge variant="secondary">{article.category}</Badge>
              )}
              {article.tags?.map((tag) => (
                <Badge key={tag} variant="outline">{tag}</Badge>
              ))}
            </div>
            
            <h1 className="text-3xl md:text-4xl font-bold mb-4" data-testid="text-article-title">
              {article.title}
            </h1>
            
            <p className="text-xl text-muted-foreground mb-6">
              {article.summary}
            </p>

            <div className="flex items-center justify-between gap-4 flex-wrap text-sm text-muted-foreground">
              <div className="flex items-center gap-4">
                {article.publishedAt && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    {format(new Date(article.publishedAt), "MMMM d, yyyy")}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  {estimatedReadTime} min read
                </div>
              </div>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  if (navigator.share) {
                    navigator.share({
                      title: article.title,
                      text: article.summary,
                      url: window.location.href,
                    });
                  } else {
                    navigator.clipboard.writeText(window.location.href);
                  }
                }}
                data-testid="button-share-article"
              >
                <Share2 className="h-4 w-4 mr-2" />
                Share
              </Button>
            </div>
          </header>

          {article.heroImageUrl && (
            <figure className="not-prose mb-8">
              <img
                src={article.heroImageUrl}
                alt={article.title}
                className="w-full h-auto rounded-lg object-cover max-h-96"
              />
            </figure>
          )}

          <div 
            className="article-content"
            dangerouslySetInnerHTML={{ __html: formatArticleContent(article.content) }}
          />
        </article>

        <div className="mt-12 pt-8 border-t">
          <h3 className="text-lg font-semibold mb-4">Continue Reading</h3>
          <Link href="/news">
            <Button variant="outline">
              View All Articles
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}

function formatArticleContent(content: string): string {
  return content
    .split("\n\n")
    .map(paragraph => {
      if (paragraph.startsWith("# ")) {
        return `<h2>${paragraph.slice(2)}</h2>`;
      }
      if (paragraph.startsWith("## ")) {
        return `<h3>${paragraph.slice(3)}</h3>`;
      }
      if (paragraph.startsWith("### ")) {
        return `<h4>${paragraph.slice(4)}</h4>`;
      }
      if (paragraph.startsWith("- ")) {
        const items = paragraph.split("\n").map(line => 
          line.startsWith("- ") ? `<li>${line.slice(2)}</li>` : `<li>${line}</li>`
        ).join("");
        return `<ul>${items}</ul>`;
      }
      return `<p>${paragraph}</p>`;
    })
    .join("");
}
