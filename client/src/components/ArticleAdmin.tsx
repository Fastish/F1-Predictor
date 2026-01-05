import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Edit,
  Settings,
  Save
} from "lucide-react";
import type { Article, ArticleContextRules } from "@shared/schema";

const ARTICLES_QUERY_KEY = "/api/admin/articles";

export function ArticleAdmin() {
  const { walletAddress } = useWallet();
  const { toast } = useToast();
  const [selectedTopic, setSelectedTopic] = useState<string>("");
  const [customPrompt, setCustomPrompt] = useState<string>("");
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [editingArticle, setEditingArticle] = useState<Article | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("articles");

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

  const { data: contextRules } = useQuery<ArticleContextRules | null>({
    queryKey: ["/api/admin/context-rules/active"],
    queryFn: async () => {
      const res = await fetch("/api/admin/context-rules/active", {
        headers: { "x-wallet-address": walletAddress || "" },
      });
      if (!res.ok) throw new Error("Failed to fetch context rules");
      return res.json();
    },
    enabled: !!walletAddress,
  });
  
  const invalidateArticles = () => {
    queryClient.invalidateQueries({ queryKey: [ARTICLES_QUERY_KEY] });
  };
  
  const invalidateContextRules = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/context-rules/active"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/context-rules"] });
  };

  const generateMutation = useMutation({
    mutationFn: async ({ topic, customPrompt }: { topic?: string; customPrompt?: string }) => {
      const res = await fetch("/api/admin/articles/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet-address": walletAddress || "",
        },
        body: JSON.stringify({ topic, customPrompt }),
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
      setCustomPrompt("");
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

  const saveContextRulesMutation = useMutation({
    mutationFn: async (rules: Partial<ArticleContextRules>) => {
      const method = contextRules?.id ? "PATCH" : "POST";
      const url = contextRules?.id 
        ? `/api/admin/context-rules/${contextRules.id}` 
        : "/api/admin/context-rules";
      
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-wallet-address": walletAddress || "",
        },
        body: JSON.stringify(rules),
      });
      if (!res.ok) throw new Error("Failed to save context rules");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Writing Rules Saved" });
      invalidateContextRules();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
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
                <div className="space-y-2">
                  <Label>Custom Instructions (optional)</Label>
                  <Textarea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="Add specific instructions for this article, e.g., 'Focus on betting strategies for the Monaco GP' or 'Include recent driver stats'"
                    rows={3}
                    data-testid="input-custom-prompt"
                  />
                </div>
                {contextRules && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Settings className="h-3 w-3" />
                    Using writing rules: {contextRules.name || "default"}
                  </div>
                )}
                <Button
                  className="w-full"
                  onClick={() => generateMutation.mutate({ 
                    topic: selectedTopic === "random" ? undefined : selectedTopic,
                    customPrompt: customPrompt || undefined 
                  })}
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
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="articles" data-testid="tab-articles">Articles</TabsTrigger>
            <TabsTrigger value="settings" data-testid="tab-settings">Writing Rules</TabsTrigger>
          </TabsList>
          
          <TabsContent value="articles" className="space-y-6">
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
          </TabsContent>
          
          <TabsContent value="settings">
            <ContextRulesForm
              contextRules={contextRules}
              onSave={(rules) => saveContextRulesMutation.mutate(rules)}
              isPending={saveContextRulesMutation.isPending}
            />
          </TabsContent>
        </Tabs>
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

function ContextRulesForm({
  contextRules,
  onSave,
  isPending,
}: {
  contextRules: ArticleContextRules | null | undefined;
  onSave: (rules: Partial<ArticleContextRules>) => void;
  isPending: boolean;
}) {
  const [toneOfVoice, setToneOfVoice] = useState(contextRules?.toneOfVoice || "");
  const [writingStyle, setWritingStyle] = useState(contextRules?.writingStyle || "");
  const [targetAudience, setTargetAudience] = useState(contextRules?.targetAudience || "");
  const [additionalRules, setAdditionalRules] = useState(contextRules?.additionalRules || "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      toneOfVoice: toneOfVoice || null,
      writingStyle: writingStyle || null,
      targetAudience: targetAudience || null,
      additionalRules: additionalRules || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-sm text-muted-foreground mb-4">
        Configure the writing style and tone for AI-generated articles. These rules will apply to all new articles.
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="toneOfVoice">Tone of Voice</Label>
        <Textarea
          id="toneOfVoice"
          value={toneOfVoice}
          onChange={(e) => setToneOfVoice(e.target.value)}
          placeholder="e.g., Professional but accessible, enthusiastic about F1, confident in predictions"
          rows={2}
          data-testid="input-tone-of-voice"
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="writingStyle">Writing Style</Label>
        <Textarea
          id="writingStyle"
          value={writingStyle}
          onChange={(e) => setWritingStyle(e.target.value)}
          placeholder="e.g., Use short paragraphs, include statistics and data, avoid jargon"
          rows={2}
          data-testid="input-writing-style"
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="targetAudience">Target Audience</Label>
        <Textarea
          id="targetAudience"
          value={targetAudience}
          onChange={(e) => setTargetAudience(e.target.value)}
          placeholder="e.g., F1 fans who are new to prediction markets, experienced sports bettors"
          rows={2}
          data-testid="input-target-audience"
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="additionalRules">Additional Guidelines</Label>
        <Textarea
          id="additionalRules"
          value={additionalRules}
          onChange={(e) => setAdditionalRules(e.target.value)}
          placeholder="Any other specific guidelines for the AI writer, e.g., always mention odds, include driver quotes when relevant"
          rows={3}
          data-testid="input-additional-rules"
        />
      </div>
      
      <Button type="submit" disabled={isPending} className="w-full" data-testid="button-save-rules">
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Saving...
          </>
        ) : (
          <>
            <Save className="h-4 w-4 mr-2" />
            Save Writing Rules
          </>
        )}
      </Button>
    </form>
  );
}
