import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useWallet } from "@/context/WalletContext";
import { 
  FileText, 
  Sparkles, 
  Trash2, 
  Eye, 
  Send, 
  RefreshCw, 
  ExternalLink,
  Loader2,
  Edit
} from "lucide-react";
import type { Article } from "@shared/schema";

const ARTICLES_QUERY_KEY = "/api/admin/articles";

export function ArticleAdmin() {
  const { walletAddress } = useWallet();
  const { toast } = useToast();
  const [selectedTopic, setSelectedTopic] = useState<string>("");
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [editingArticle, setEditingArticle] = useState<Article | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);

  const { data: articles = [], isLoading } = useQuery<Article[]>({
    queryKey: [ARTICLES_QUERY_KEY],
    queryFn: async () => {
      const res = await fetch("/api/admin/articles", {
        headers: { "x-wallet-address": walletAddress || "" },
      });
      if (!res.ok) throw new Error("Failed to fetch articles");
      return res.json();
    },
    enabled: !!walletAddress,
  });

  const { data: topics = [] } = useQuery<string[]>({
    queryKey: ["/api/admin/articles/topics"],
    queryFn: async () => {
      const res = await fetch("/api/admin/articles/topics");
      if (!res.ok) throw new Error("Failed to fetch topics");
      const data = await res.json();
      return data.topics;
    },
  });
  
  const invalidateArticles = () => {
    queryClient.invalidateQueries({ queryKey: [ARTICLES_QUERY_KEY] });
  };

  const generateMutation = useMutation({
    mutationFn: async (topic?: string) => {
      const res = await fetch("/api/admin/articles/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet-address": walletAddress || "",
        },
        body: JSON.stringify({ topic }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to generate article");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Article Generated",
        description: `"${data.article.title}" created as draft.`,
      });
      setShowGenerateDialog(false);
      setSelectedTopic("");
      invalidateArticles();
    },
    onError: (error: any) => {
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate article",
        variant: "destructive",
      });
    },
  });

  const publishMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/articles/${id}/publish`, {
        method: "POST",
        headers: { "x-wallet-address": walletAddress || "" },
      });
      if (!res.ok) throw new Error("Failed to publish article");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Article Published" });
      invalidateArticles();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/articles/${id}`, {
        method: "DELETE",
        headers: { "x-wallet-address": walletAddress || "" },
      });
      if (!res.ok) throw new Error("Failed to delete article");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Article Deleted" });
      invalidateArticles();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Article> }) => {
      const res = await fetch(`/api/admin/articles/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-wallet-address": walletAddress || "",
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update article");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Article Updated" });
      setShowEditDialog(false);
      setEditingArticle(null);
      invalidateArticles();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const draftArticles = articles.filter(a => a.status === "draft");
  const publishedArticles = articles.filter(a => a.status === "published");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Article Management
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => invalidateArticles()}
            disabled={isLoading}
            data-testid="button-refresh-articles"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
          <Dialog open={showGenerateDialog} onOpenChange={setShowGenerateDialog}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-generate-article">
                <Sparkles className="h-4 w-4 mr-1" />
                Generate Article
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Generate AI Article</DialogTitle>
                <DialogDescription>
                  Use AI to generate an F1-related article. The article will be saved as a draft for review.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Select Topic (optional)</Label>
                  <Select value={selectedTopic} onValueChange={setSelectedTopic}>
                    <SelectTrigger data-testid="select-topic">
                      <SelectValue placeholder="Random topic" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="random">Random Topic</SelectItem>
                      {topics.map((topic) => (
                        <SelectItem key={topic} value={topic}>
                          {topic}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full"
                  onClick={() => generateMutation.mutate(selectedTopic === "random" ? undefined : selectedTopic)}
                  disabled={generateMutation.isPending}
                  data-testid="button-confirm-generate"
                >
                  {generateMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Generate Article
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 rounded-md bg-muted/50">
            <p className="text-2xl font-bold">{articles.length}</p>
            <p className="text-sm text-muted-foreground">Total Articles</p>
          </div>
          <div className="p-4 rounded-md bg-muted/50">
            <p className="text-2xl font-bold">{draftArticles.length}</p>
            <p className="text-sm text-muted-foreground">Drafts</p>
          </div>
          <div className="p-4 rounded-md bg-muted/50">
            <p className="text-2xl font-bold">{publishedArticles.length}</p>
            <p className="text-sm text-muted-foreground">Published</p>
          </div>
        </div>

        {draftArticles.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-medium flex items-center gap-2">
              <Badge variant="secondary">{draftArticles.length}</Badge>
              Draft Articles
            </h3>
            <div className="space-y-2">
              {draftArticles.map((article) => (
                <div
                  key={article.id}
                  className="flex items-center justify-between gap-3 p-3 rounded bg-muted/50"
                  data-testid={`article-row-${article.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{article.title}</p>
                    <p className="text-sm text-muted-foreground truncate">{article.summary}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">{article.category}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(article.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => window.open(`/news/${article.slug}`, "_blank")}
                      data-testid={`button-preview-${article.id}`}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setEditingArticle(article);
                        setShowEditDialog(true);
                      }}
                      data-testid={`button-edit-${article.id}`}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => publishMutation.mutate(article.id)}
                      disabled={publishMutation.isPending}
                      data-testid={`button-publish-${article.id}`}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("Delete this article?")) {
                          deleteMutation.mutate(article.id);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-${article.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {publishedArticles.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-medium flex items-center gap-2">
              <Badge>{publishedArticles.length}</Badge>
              Published Articles
            </h3>
            <div className="space-y-2">
              {publishedArticles.slice(0, 5).map((article) => (
                <div
                  key={article.id}
                  className="flex items-center justify-between gap-3 p-3 rounded bg-muted/50"
                  data-testid={`article-published-${article.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{article.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">{article.category}</Badge>
                      {article.publishedAt && (
                        <span className="text-xs text-muted-foreground">
                          Published {new Date(article.publishedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => window.open(`/news/${article.slug}`, "_blank")}
                      data-testid={`button-view-${article.id}`}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("Delete this published article?")) {
                          deleteMutation.mutate(article.id);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-published-${article.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {publishedArticles.length > 5 && (
                <p className="text-sm text-muted-foreground text-center">
                  ...and {publishedArticles.length - 5} more articles
                </p>
              )}
            </div>
          </div>
        )}

        {articles.length === 0 && !isLoading && (
          <div className="text-center py-8">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No articles yet. Generate your first article!</p>
          </div>
        )}
      </CardContent>

      <Dialog open={showEditDialog} onOpenChange={(open) => {
        setShowEditDialog(open);
        if (!open) setEditingArticle(null);
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Article</DialogTitle>
          </DialogHeader>
          {editingArticle && (
            <EditArticleForm
              article={editingArticle}
              onSave={(data) => updateMutation.mutate({ id: editingArticle.id, data })}
              isPending={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function EditArticleForm({
  article,
  onSave,
  isPending,
}: {
  article: Article;
  onSave: (data: Partial<Article>) => void;
  isPending: boolean;
}) {
  const [title, setTitle] = useState(article.title);
  const [summary, setSummary] = useState(article.summary);
  const [content, setContent] = useState(article.content);
  const [metaTitle, setMetaTitle] = useState(article.metaTitle || "");
  const [metaDescription, setMetaDescription] = useState(article.metaDescription || "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      title,
      summary,
      content,
      metaTitle: metaTitle || undefined,
      metaDescription: metaDescription || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          data-testid="input-edit-title"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="summary">Summary</Label>
        <Textarea
          id="summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={2}
          required
          data-testid="input-edit-summary"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="content">Content (Markdown)</Label>
        <Textarea
          id="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={10}
          required
          data-testid="input-edit-content"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="metaTitle">SEO Title</Label>
          <Input
            id="metaTitle"
            value={metaTitle}
            onChange={(e) => setMetaTitle(e.target.value)}
            placeholder="Max 60 chars"
            data-testid="input-edit-meta-title"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="metaDescription">SEO Description</Label>
          <Input
            id="metaDescription"
            value={metaDescription}
            onChange={(e) => setMetaDescription(e.target.value)}
            placeholder="Max 155 chars"
            data-testid="input-edit-meta-description"
          />
        </div>
      </div>
      <Button type="submit" disabled={isPending} className="w-full" data-testid="button-save-article">
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Saving...
          </>
        ) : (
          "Save Changes"
        )}
      </Button>
    </form>
  );
}
