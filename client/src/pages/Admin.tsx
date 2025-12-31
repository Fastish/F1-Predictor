import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@/context/WalletContext";
import { AdminPanel } from "@/components/AdminPanel";
import { Header } from "@/components/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSEO } from "@/hooks/useSEO";
import { ShieldAlert, Wallet, Lock } from "lucide-react";
import { Link } from "wouter";

export default function Admin() {
  useSEO({
    title: "Admin Panel",
    description: "F1 Predict administration panel. Manage seasons, markets, fees, and platform settings."
  });

  const { walletAddress, connectWallet, isConnecting } = useWallet();

  const { data: adminCheck, isLoading: checkingAdmin } = useQuery<{ isAdmin: boolean }>({
    queryKey: walletAddress ? [`/api/admin/check/${walletAddress}`] : ["admin-check-disabled"],
    enabled: !!walletAddress,
  });

  const isAdmin = adminCheck?.isAdmin ?? false;

  if (!walletAddress) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex items-center justify-center py-20">
          <Card className="max-w-md w-full mx-4">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 p-3 rounded-full bg-muted">
                <Wallet className="h-8 w-8 text-muted-foreground" />
              </div>
              <CardTitle>Connect Wallet to Access Admin</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-center text-muted-foreground">
                You need to connect your wallet to access the admin panel. 
                Only authorized wallet addresses can view this page.
              </p>
              <Button 
                onClick={connectWallet} 
                disabled={isConnecting}
                className="w-full"
                data-testid="button-connect-admin"
              >
                {isConnecting ? "Connecting..." : "Connect Wallet"}
              </Button>
              <div className="text-center">
                <Link href="/">
                  <span className="text-sm text-muted-foreground hover:text-foreground cursor-pointer">
                    Back to Market
                  </span>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (checkingAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex items-center justify-center py-20">
          <div className="text-muted-foreground">Verifying admin access...</div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex items-center justify-center py-20">
          <Card className="max-w-md w-full mx-4">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 p-3 rounded-full bg-destructive/10">
                <Lock className="h-8 w-8 text-destructive" />
              </div>
              <CardTitle>Access Denied</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-center text-muted-foreground">
                Your wallet address is not authorized to access the admin panel.
              </p>
              <div className="bg-muted p-3 rounded-md">
                <p className="text-xs text-muted-foreground break-all font-mono">
                  {walletAddress}
                </p>
              </div>
              <div className="text-center">
                <Link href="/">
                  <span className="text-sm text-muted-foreground hover:text-foreground cursor-pointer">
                    Back to Market
                  </span>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="py-8">
        <div className="mx-auto max-w-7xl px-4">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-md bg-primary/10">
              <ShieldAlert className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-admin-title">Admin Panel</h1>
              <p className="text-sm text-muted-foreground">
                Manage seasons, declare winners, and distribute payouts
              </p>
            </div>
          </div>
          <AdminPanel />
        </div>
      </div>
    </div>
  );
}
