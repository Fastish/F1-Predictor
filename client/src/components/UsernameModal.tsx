import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWallet } from "@/context/WalletContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface UsernameModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UsernameModal({ open, onOpenChange }: UsernameModalProps) {
  const { walletAddress } = useWallet();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState("");

  const { data: profile, isLoading } = useQuery<{ walletAddress: string; displayName: string | null }>({
    queryKey: [`/api/user/profile/${walletAddress}`],
    enabled: !!walletAddress && open,
  });

  useEffect(() => {
    if (profile?.displayName) {
      setDisplayName(profile.displayName);
    } else {
      setDisplayName("");
    }
  }, [profile]);

  const updateMutation = useMutation({
    mutationFn: async (newDisplayName: string) => {
      const response = await apiRequest("PATCH", "/api/user/display-name", {
        walletAddress,
        displayName: newDisplayName,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Username updated",
        description: "Your display name has been saved.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/user/profile/${walletAddress}`] });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update username",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const trimmed = displayName.trim();
    if (!trimmed) {
      toast({
        title: "Invalid username",
        description: "Username cannot be empty.",
        variant: "destructive",
      });
      return;
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      toast({
        title: "Invalid username",
        description: "Username can only contain letters, numbers, and underscores.",
        variant: "destructive",
      });
      return;
    }

    if (trimmed.length < 1 || trimmed.length > 30) {
      toast({
        title: "Invalid username",
        description: "Username must be 1-30 characters.",
        variant: "destructive",
      });
      return;
    }

    updateMutation.mutate(trimmed);
  };

  if (!walletAddress) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set Username</DialogTitle>
          <DialogDescription>
            Choose a display name that will be shown on your comments and activity.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="display-name">Display Name</Label>
              <Input
                id="display-name"
                placeholder="Enter username"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={30}
                data-testid="input-display-name"
              />
              <p className="text-xs text-muted-foreground">
                Letters, numbers, and underscores only. 1-30 characters.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="button-cancel-username"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={updateMutation.isPending}
                data-testid="button-save-username"
              >
                {updateMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
