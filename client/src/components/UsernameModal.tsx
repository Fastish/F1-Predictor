import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Check, X, AlertCircle } from "lucide-react";
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

interface PolymarketProfile {
  name: string | null;
  pseudonym: string | null;
  proxyWallet: string | null;
  profileImage: string | null;
}

export function UsernameModal({ open, onOpenChange }: UsernameModalProps) {
  const { walletAddress } = useWallet();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState("");
  const [debouncedName, setDebouncedName] = useState("");
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);

  const { data: profile, isLoading: isLoadingProfile } = useQuery<{ walletAddress: string; displayName: string | null }>({
    queryKey: [`/api/user/profile/${walletAddress}`],
    enabled: !!walletAddress && open,
  });

  const { data: polymarketProfile, isLoading: isLoadingPolymarket } = useQuery<PolymarketProfile>({
    queryKey: [`/api/polymarket/profile/${walletAddress}`],
    enabled: !!walletAddress && open,
  });

  useEffect(() => {
    if (profile?.displayName) {
      setDisplayName(profile.displayName);
    } else if (polymarketProfile?.name) {
      setDisplayName(polymarketProfile.name);
    } else {
      setDisplayName("");
    }
  }, [profile, polymarketProfile]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedName(displayName.trim());
    }, 500);
    return () => clearTimeout(timer);
  }, [displayName]);

  const checkAvailability = useCallback(async (name: string) => {
    if (!name || name.length < 1 || !/^[a-zA-Z0-9_]+$/.test(name)) {
      setIsAvailable(null);
      return;
    }

    if (profile?.displayName?.toLowerCase() === name.toLowerCase()) {
      setIsAvailable(true);
      return;
    }

    setIsCheckingAvailability(true);
    try {
      const response = await fetch(
        `/api/user/check-username/${encodeURIComponent(name)}?excludeWallet=${walletAddress}`
      );
      const data = await response.json();
      setIsAvailable(data.available);
    } catch (error) {
      setIsAvailable(null);
    } finally {
      setIsCheckingAvailability(false);
    }
  }, [walletAddress, profile?.displayName]);

  useEffect(() => {
    if (debouncedName) {
      checkAvailability(debouncedName);
    } else {
      setIsAvailable(null);
    }
  }, [debouncedName, checkAvailability]);

  const updateMutation = useMutation({
    mutationFn: async (newDisplayName: string) => {
      const response = await apiRequest("PATCH", "/api/user/display-name", {
        walletAddress,
        displayName: newDisplayName,
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update username");
      }
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

    if (isAvailable === false) {
      toast({
        title: "Username unavailable",
        description: "This username is already taken. Please choose another.",
        variant: "destructive",
      });
      return;
    }

    updateMutation.mutate(trimmed);
  };

  if (!walletAddress) {
    return null;
  }

  const isLoading = isLoadingProfile || isLoadingPolymarket;
  const trimmedName = displayName.trim();
  const isValidFormat = trimmedName.length >= 1 && trimmedName.length <= 30 && /^[a-zA-Z0-9_]+$/.test(trimmedName);
  const canSubmit = isValidFormat && isAvailable !== false && !updateMutation.isPending;

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
            {polymarketProfile?.name && !profile?.displayName && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-muted">
                <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <p className="text-sm text-muted-foreground">
                  Your Polymarket username "<span className="font-medium text-foreground">{polymarketProfile.name}</span>" was detected. You can use it or choose a different one.
                </p>
              </div>
            )}

            {profile?.displayName && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-muted">
                <Check className="h-4 w-4 mt-0.5 text-green-600 dark:text-green-400 shrink-0" />
                <p className="text-sm text-muted-foreground">
                  Current username: <span className="font-medium text-foreground">{profile.displayName}</span>
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="display-name">Display Name</Label>
              <div className="relative">
                <Input
                  id="display-name"
                  placeholder="Enter username"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={30}
                  className="pr-10"
                  data-testid="input-display-name"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {isCheckingAvailability ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : isAvailable === true && trimmedName ? (
                    <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                  ) : isAvailable === false && trimmedName ? (
                    <X className="h-4 w-4 text-red-600 dark:text-red-400" />
                  ) : null}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Letters, numbers, and underscores only. 1-30 characters.
                </p>
                {isAvailable === false && trimmedName && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    Username taken
                  </p>
                )}
                {isAvailable === true && trimmedName && (
                  <p className="text-xs text-green-600 dark:text-green-400">
                    Available
                  </p>
                )}
              </div>
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
                disabled={!canSubmit}
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
