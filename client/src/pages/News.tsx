import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { useSEO } from "@/hooks/useSEO";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Newspaper, Calendar, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import type { Article } from "@shared/schema";

export default function News() {
  useSEO({
    title: "F1 News & Analysis 2026",
    description: "Stay updated with the latest Formula 1 news, analysis, and insights. Expert coverage of the 2026 F1 season, team updates, and driver news."
  });

  const { data: articles = [], isLoading } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
    refetchInterval: 60000,
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Newspaper className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold" data-testid="text-news-title">
              F1 News & Analysis
            </h1>
          </div>
          <p className="text-muted-foreground text-lg">
            Expert analysis and insights for the 2026 Formula 1 season
          </p>
        </div>

        {isLoading ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-1/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : articles.length === 0 ? (
          <Card className="py-12">
            <CardContent className="text-center">
              <Newspaper className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No articles yet</h3>
              <p className="text-muted-foreground">
                Check back soon for the latest F1 news and analysis.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {articles.map((article) => (
              <Link key={article.id} href={`/news/${article.slug}`}>
                <Card className="h-full hover-elevate cursor-pointer transition-all" data-testid={`card-article-${article.id}`}>
                  {(article.thumbnailUrl || article.heroImageUrl) && (
                    <div className="relative w-full h-48 overflow-hidden rounded-t-md">
                      <img
                        src={article.thumbnailUrl || article.heroImageUrl || ""}
                        alt={article.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <CardHeader>
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      {article.category && (
                        <Badge variant="secondary" className="text-xs">
                          {article.category}
                        </Badge>
                      )}
                      {article.tags?.slice(0, 2).map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    <CardTitle className="text-lg line-clamp-2">{article.title}</CardTitle>
                    <CardDescription className="line-clamp-3">{article.summary}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {article.publishedAt && format(new Date(article.publishedAt), "MMM d, yyyy")}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-primary font-medium">
                      Read more <ArrowRight className="h-3 w-3" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
