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
  Save,
  Image,
  Twitter,
  Upload,
  EyeOff
} from "lucide-react";
import type { Article, ArticleContextRules, DailyRoundupSettings } from "@shared/schema";
import { useUpload } from "@/hooks/use-upload";
import { Clock, Newspaper } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  const [articleType, setArticleType] = useState<"standard" | "daily-roundup">("standard");

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

  const { data: roundupSettings } = useQuery<DailyRoundupSettings | null>({
    queryKey: ["/api/admin/roundup-settings"],
    queryFn: async () => {
      const res = await fetch("/api/admin/roundup-settings", {
        headers: { "x-wallet-address": walletAddress || "" },
      });
      if (!res.ok) throw new Error("Failed to fetch roundup settings");
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

  const invalidateRoundupSettings = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/roundup-settings"] });
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
      setArticleType("standard");
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

  const generateRoundupMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/articles/generate-roundup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet-address": walletAddress || "",
        },
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to generate daily roundup");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Daily Roundup Generated",
        description: `"${data.article.title}" created as draft.`,
      });
      setShowGenerateDialog(false);
      setArticleType("standard");
      invalidateArticles();
    },
    onError: (error: any) => {
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate daily roundup",
        variant: "destructive",
      });
    },
  });

  const updateRoundupSettingsMutation = useMutation({
    mutationFn: async (updates: Partial<DailyRoundupSettings>) => {
      const res = await fetch("/api/admin/roundup-settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-wallet-address": walletAddress || "",
        },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update roundup settings");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Settings Updated" });
      invalidateRoundupSettings();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
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

  const postToTwitterMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/articles/${id}/post-to-twitter`, {
        method: "POST",
        headers: { "x-wallet-address": walletAddress || "" },
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to post to X");
      }
      return res.json();
    },
    onSuccess: (data: { tweetUrl?: string }) => {
      toast({ 
        title: "Posted to X",
        description: data.tweetUrl ? "Click to view tweet" : "Article shared successfully",
      });
      if (data.tweetUrl) {
        window.open(data.tweetUrl, "_blank");
      }
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Post to X",
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
                  <Label>Article Type</Label>
                  <Select value={articleType} onValueChange={(v) => setArticleType(v as "standard" | "daily-roundup")}>
                    <SelectTrigger data-testid="select-article-type">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4" />
                          Standard Article
                        </div>
                      </SelectItem>
                      <SelectItem value="daily-roundup">
                        <div className="flex items-center gap-2">
                          <Newspaper className="h-4 w-4" />
                          Daily Roundup
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {articleType === "standard" && (
                  <>
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
                  </>
                )}

                {articleType === "daily-roundup" && (
                  <div className="p-3 rounded-md bg-muted/50 text-sm">
                    <p className="font-medium flex items-center gap-2">
                      <Newspaper className="h-4 w-4" />
                      Daily Roundup
                    </p>
                    <p className="text-muted-foreground mt-1">
                      Automatically fetches and summarizes the latest F1 news from trusted sources. 
                      Includes links to original articles.
                    </p>
                  </div>
                )}

                {contextRules && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Settings className="h-3 w-3" />
                    Using writing rules: {contextRules.name || "default"}
                  </div>
                )}

                {articleType === "standard" ? (
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
                ) : (
                  <Button
                    className="w-full"
                    onClick={() => generateRoundupMutation.mutate()}
                    disabled={generateRoundupMutation.isPending}
                    data-testid="button-confirm-generate-roundup"
                  >
                    {generateRoundupMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Generating Roundup...
                      </>
                    ) : (
                      <>
                        <Newspaper className="h-4 w-4 mr-2" />
                        Generate Daily Roundup
                      </>
                    )}
                  </Button>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="articles" data-testid="tab-articles">Articles</TabsTrigger>
            <TabsTrigger value="roundup" data-testid="tab-roundup">Daily Roundup</TabsTrigger>
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
                            setEditingArticle(article);
                            setShowEditDialog(true);
                          }}
                          data-testid={`button-edit-published-${article.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            if (confirm("Post this article to X.com?")) {
                              postToTwitterMutation.mutate(article.id);
                            }
                          }}
                          disabled={postToTwitterMutation.isPending}
                          title="Post to X.com"
                          data-testid={`button-tweet-${article.id}`}
                        >
                          <Twitter className="h-4 w-4" />
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

          <TabsContent value="roundup" className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Automated Daily Roundup</h3>
                  <p className="text-sm text-muted-foreground">
                    Automatically generate and publish a daily F1 news summary
                  </p>
                </div>
                <Switch
                  checked={roundupSettings?.enabled ?? false}
                  onCheckedChange={(enabled) => updateRoundupSettingsMutation.mutate({ enabled })}
                  disabled={updateRoundupSettingsMutation.isPending}
                  data-testid="switch-roundup-enabled"
                />
              </div>

              {roundupSettings?.enabled && (
                <div className="space-y-4 p-4 rounded-md bg-muted/50">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Publish Time (Hour)</Label>
                      <Select
                        value={String(roundupSettings?.scheduledHour ?? 8)}
                        onValueChange={(v) => updateRoundupSettingsMutation.mutate({ scheduledHour: parseInt(v) })}
                      >
                        <SelectTrigger data-testid="select-roundup-hour">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 24 }, (_, i) => (
                            <SelectItem key={i} value={String(i)}>
                              {i.toString().padStart(2, '0')}:00
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Timezone</Label>
                      <Select
                        value={roundupSettings?.timezone ?? "UTC"}
                        onValueChange={(v) => updateRoundupSettingsMutation.mutate({ timezone: v })}
                      >
                        <SelectTrigger data-testid="select-roundup-timezone">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="UTC">UTC</SelectItem>
                          <SelectItem value="America/New_York">Eastern Time</SelectItem>
                          <SelectItem value="America/Los_Angeles">Pacific Time</SelectItem>
                          <SelectItem value="Europe/London">London</SelectItem>
                          <SelectItem value="Europe/Paris">Paris</SelectItem>
                          <SelectItem value="Asia/Tokyo">Tokyo</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <div>
                      <p className="text-sm font-medium">Auto-publish</p>
                      <p className="text-xs text-muted-foreground">Automatically publish when generated</p>
                    </div>
                    <Switch
                      checked={roundupSettings?.autoPublish ?? true}
                      onCheckedChange={(autoPublish) => updateRoundupSettingsMutation.mutate({ autoPublish })}
                      disabled={updateRoundupSettingsMutation.isPending}
                      data-testid="switch-auto-publish"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Auto-tweet on publish</p>
                      <p className="text-xs text-muted-foreground">Share to X.com when article is published</p>
                    </div>
                    <Switch
                      checked={roundupSettings?.autoTweet ?? true}
                      onCheckedChange={(autoTweet) => updateRoundupSettingsMutation.mutate({ autoTweet })}
                      disabled={updateRoundupSettingsMutation.isPending}
                      data-testid="switch-auto-tweet"
                    />
                  </div>

                  {roundupSettings?.lastGeneratedAt && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1 pt-2 border-t">
                      <Clock className="h-3 w-3" />
                      Last generated: {new Date(roundupSettings.lastGeneratedAt).toLocaleString()}
                    </div>
                  )}
                </div>
              )}

              <div className="pt-4 border-t">
                <h4 className="font-medium mb-2">Manual Generation</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Generate a daily roundup article now, regardless of schedule settings.
                </p>
                <Button
                  onClick={() => generateRoundupMutation.mutate()}
                  disabled={generateRoundupMutation.isPending}
                  data-testid="button-generate-roundup-manual"
                >
                  {generateRoundupMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Newspaper className="h-4 w-4 mr-2" />
                      Generate Daily Roundup Now
                    </>
                  )}
                </Button>
              </div>

              <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-sm">
                <p className="font-medium text-amber-600 dark:text-amber-400">X.com API Required</p>
                <p className="text-muted-foreground mt-1">
                  To auto-publish to X.com, add your Twitter API credentials as secrets: 
                  TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET
                </p>
              </div>
            </div>
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
  const { toast } = useToast();
  const { walletAddress } = useWallet();
  const [title, setTitle] = useState(article.title);
  const [summary, setSummary] = useState(article.summary);
  const [content, setContent] = useState(article.content);
  const [thumbnailUrl, setThumbnailUrl] = useState(article.thumbnailUrl || "");
  const [heroImageUrl, setHeroImageUrl] = useState(article.heroImageUrl || "");
  const [heroImageCaption, setHeroImageCaption] = useState(article.heroImageCaption || "");
  const [metaTitle, setMetaTitle] = useState(article.metaTitle || "");
  const [metaDescription, setMetaDescription] = useState(article.metaDescription || "");
  const [isUploading, setIsUploading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: "hero" | "thumbnail") => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      // Get presigned URL from server
      const presignResponse = await fetch(`/api/admin/articles/${article.id}/upload-image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet-address": walletAddress || "",
        },
      });
      
      if (!presignResponse.ok) {
        throw new Error("Failed to get upload URL");
      }
      
      const { uploadURL, objectPath } = await presignResponse.json();
      
      // Upload file directly to presigned URL
      const uploadResponse = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "image/png",
        },
      });
      
      if (!uploadResponse.ok) {
        throw new Error("Failed to upload file");
      }
      
      // Confirm upload and update article
      const confirmResponse = await fetch(`/api/admin/articles/${article.id}/confirm-image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet-address": walletAddress || "",
        },
        body: JSON.stringify({ objectPath }),
      });
      
      if (!confirmResponse.ok) {
        throw new Error("Failed to confirm upload");
      }
      
      // Update local state with the object path
      if (type === "hero") {
        setHeroImageUrl(objectPath);
        if (!thumbnailUrl) {
          setThumbnailUrl(objectPath);
        }
      } else {
        setThumbnailUrl(objectPath);
      }
      
      toast({
        title: "Image Uploaded",
        description: "Image uploaded successfully to storage.",
      });
    } catch (error: any) {
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload image",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      // Reset file input
      e.target.value = "";
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const updates: Partial<Article> = {
      summary,
      content,
      thumbnailUrl: thumbnailUrl || null,
      heroImageUrl: heroImageUrl || null,
      heroImageCaption: heroImageCaption || null,
      metaTitle: metaTitle || undefined,
      metaDescription: metaDescription || undefined,
    };
    // Only include title if it actually changed to avoid slug regeneration
    if (title !== article.title) {
      updates.title = title;
    }
    onSave(updates);
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
        <div className="flex items-center justify-between">
          <Label htmlFor="content">Content (Markdown)</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
            data-testid="button-toggle-preview"
          >
            {showPreview ? (
              <>
                <EyeOff className="h-3 w-3 mr-1" />
                Hide Preview
              </>
            ) : (
              <>
                <Eye className="h-3 w-3 mr-1" />
                Preview
              </>
            )}
          </Button>
        </div>
        {showPreview ? (
          <div 
            className="prose prose-sm dark:prose-invert max-w-none p-4 rounded-md border bg-background min-h-[200px] max-h-[400px] overflow-y-auto"
            data-testid="content-preview"
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                img: ({ node, alt, src, title, ...props }) => (
                  <figure className="my-4">
                    <img
                      src={src}
                      alt={alt || ""}
                      className="w-full h-auto rounded-lg object-cover max-h-48"
                      {...props}
                    />
                    {title && (
                      <figcaption className="text-xs text-muted-foreground mt-1 text-center italic">
                        {title}
                      </figcaption>
                    )}
                  </figure>
                ),
                a: ({ node, children, href, ...props }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                    {...props}
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {content || "*No content yet*"}
            </ReactMarkdown>
          </div>
        ) : (
          <Textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            required
            data-testid="input-edit-content"
          />
        )}
        <p className="text-xs text-muted-foreground">
          Tip: Add images with captions on their own line: ![alt text](image-url "Photo credit or caption")
        </p>
      </div>
      <div className="space-y-4 p-4 rounded-md bg-muted/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Image className="h-4 w-4" />
            Images
          </div>
          <div className="text-xs text-muted-foreground">
            Optimal: 1200x628px or 16:9 ratio for social sharing
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="heroImageUrl">Hero / OG Image URL</Label>
            <div className="flex items-center gap-2">
              {heroImageUrl && thumbnailUrl !== heroImageUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setThumbnailUrl(heroImageUrl)}
                  data-testid="button-sync-thumbnail"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Use as Thumbnail
                </Button>
              )}
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleImageUpload(e, "hero")}
                  disabled={isUploading}
                  data-testid="input-upload-hero"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isUploading}
                  asChild
                >
                  <span>
                    {isUploading ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Upload className="h-3 w-3 mr-1" />
                    )}
                    Upload
                  </span>
                </Button>
              </label>
            </div>
          </div>
          <Input
            id="heroImageUrl"
            value={heroImageUrl}
            onChange={(e) => {
              setHeroImageUrl(e.target.value);
              if (!thumbnailUrl) {
                setThumbnailUrl(e.target.value);
              }
            }}
            placeholder="https://example.com/hero.png or upload"
            data-testid="input-edit-hero-url"
          />
          {heroImageUrl && (
            <div className="mt-2 relative">
              <div className="relative h-32 w-56 rounded-md border border-border overflow-hidden bg-muted">
                <img 
                  src={heroImageUrl} 
                  alt="Hero preview" 
                  className="h-full w-full object-cover"
                  data-testid="img-hero-preview"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent && !parent.querySelector('.error-placeholder')) {
                      const errorDiv = document.createElement('div');
                      errorDiv.className = 'error-placeholder absolute inset-0 flex flex-col items-center justify-center text-muted-foreground text-xs gap-1';
                      errorDiv.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg><span>Image not found</span>';
                      parent.appendChild(errorDiv);
                    }
                  }}
                  onLoad={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'block';
                    const parent = target.parentElement;
                    const errorPlaceholder = parent?.querySelector('.error-placeholder');
                    if (errorPlaceholder) {
                      errorPlaceholder.remove();
                    }
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Hero image preview (16:9)</p>
            </div>
          )}
          <div className="mt-2">
            <Label htmlFor="heroImageCaption" className="text-xs">Photo Credit / Caption</Label>
            <Input
              id="heroImageCaption"
              value={heroImageCaption}
              onChange={(e) => setHeroImageCaption(e.target.value)}
              placeholder="e.g., Photo: Getty Images / Reuters"
              className="mt-1"
              data-testid="input-edit-hero-caption"
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="thumbnailUrl">Thumbnail Image URL</Label>
            {thumbnailUrl && heroImageUrl !== thumbnailUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setHeroImageUrl(thumbnailUrl)}
                data-testid="button-sync-hero"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Use as Hero
              </Button>
            )}
          </div>
          <Input
            id="thumbnailUrl"
            value={thumbnailUrl}
            onChange={(e) => setThumbnailUrl(e.target.value)}
            placeholder="https://example.com/thumbnail.png"
            data-testid="input-edit-thumbnail-url"
          />
          {thumbnailUrl && (
            <div className="mt-2 relative">
              <div className="relative h-24 w-24 rounded-md border border-border overflow-hidden bg-muted">
                <img 
                  src={thumbnailUrl} 
                  alt="Thumbnail preview" 
                  className="h-full w-full object-cover"
                  data-testid="img-thumbnail-preview"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent && !parent.querySelector('.error-placeholder')) {
                      const errorDiv = document.createElement('div');
                      errorDiv.className = 'error-placeholder absolute inset-0 flex flex-col items-center justify-center text-muted-foreground text-xs gap-1';
                      errorDiv.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg><span>Not found</span>';
                      parent.appendChild(errorDiv);
                    }
                  }}
                  onLoad={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'block';
                    const parent = target.parentElement;
                    const errorPlaceholder = parent?.querySelector('.error-placeholder');
                    if (errorPlaceholder) {
                      errorPlaceholder.remove();
                    }
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Thumbnail preview</p>
            </div>
          )}
        </div>
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
