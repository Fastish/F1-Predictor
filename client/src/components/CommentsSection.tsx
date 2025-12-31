import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, MessageSquare, Send, User } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useWallet } from "@/context/WalletContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Comment {
  id: number;
  walletAddress: string;
  displayName: string | null;
  content: string;
  createdAt: string;
}

interface CommentsSectionProps {
  marketType: "constructor" | "driver" | "race";
  marketId: string;
  marketName?: string;
}

export function CommentsSection({ marketType, marketId, marketName }: CommentsSectionProps) {
  const { walletAddress } = useWallet();
  const { toast } = useToast();
  const [newComment, setNewComment] = useState("");

  const { data: comments = [], isLoading } = useQuery<Comment[]>({
    queryKey: ["/api/comments", marketType, marketId],
    enabled: !!marketId,
  });

  const { data: profile } = useQuery<{ walletAddress: string; displayName: string | null }>({
    queryKey: [`/api/user/profile/${walletAddress}`],
    enabled: !!walletAddress,
  });

  const createMutation = useMutation({
    mutationFn: async (content: string) => {
      const response = await apiRequest("POST", "/api/comments", {
        walletAddress,
        marketType,
        marketId,
        content,
      });
      return response.json();
    },
    onSuccess: () => {
      setNewComment("");
      queryClient.invalidateQueries({ queryKey: ["/api/comments", marketType, marketId] });
      toast({
        title: "Comment posted",
        description: "Your comment has been added.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to post comment",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newComment.trim();
    if (!trimmed) return;
    if (trimmed.length > 1000) {
      toast({
        title: "Comment too long",
        description: "Comments must be under 1000 characters.",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate(trimmed);
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const getDisplayIdentity = (comment: Comment) => {
    return comment.displayName || formatAddress(comment.walletAddress);
  };

  const getInitials = (comment: Comment) => {
    if (comment.displayName) {
      return comment.displayName.slice(0, 2).toUpperCase();
    }
    return comment.walletAddress.slice(2, 4).toUpperCase();
  };

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Comments {marketName && <span className="text-muted-foreground font-normal">on {marketName}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {walletAddress ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex items-start gap-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">
                  {profile?.displayName?.slice(0, 2).toUpperCase() || walletAddress.slice(2, 4).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-2">
                <Textarea
                  placeholder="Share your thoughts..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  maxLength={1000}
                  className="min-h-[80px] resize-none"
                  data-testid="textarea-new-comment"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {newComment.length}/1000
                  </span>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!newComment.trim() || createMutation.isPending}
                    data-testid="button-post-comment"
                  >
                    {createMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Send className="h-4 w-4 mr-1" />
                        Post
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </form>
        ) : (
          <div className="text-center py-4 text-muted-foreground">
            Connect your wallet to post comments
          </div>
        )}

        <div className="border-t pt-4">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : comments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No comments yet. Be the first to share your thoughts!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {comments.map((comment) => (
                <div key={comment.id} className="flex gap-3" data-testid={`comment-${comment.id}`}>
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs">
                      {getInitials(comment)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-medium text-sm" data-testid={`text-comment-author-${comment.id}`}>
                        {getDisplayIdentity(comment)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-sm mt-1 whitespace-pre-wrap break-words" data-testid={`text-comment-content-${comment.id}`}>
                      {comment.content}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
