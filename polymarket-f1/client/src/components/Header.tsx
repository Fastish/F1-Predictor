import { Link, useLocation } from 'wouter';
import { Moon, Sun, TrendingUp, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/contexts/ThemeContext';
import { useMagic } from '@/contexts/MagicContext';
import LoginModal from './LoginModal';
import { useState } from 'react';

export default function Header() {
  const { theme, toggleTheme } = useTheme();
  const { isLoggedIn, userEmail, userAddress, logout, isLoading } = useMagic();
  const [location] = useLocation();
  const [showLogin, setShowLogin] = useState(false);

  const navItems = [
    { path: '/', label: 'Markets', icon: TrendingUp },
    { path: '/portfolio', label: 'Portfolio', icon: Wallet },
  ];

  return (
    <>
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">F1</span>
              </div>
              <span className="font-semibold text-lg hidden sm:block">F1 Predict</span>
            </Link>

            <nav className="flex items-center gap-1">
              {navItems.map((item) => (
                <Link key={item.path} href={item.path}>
                  <Button
                    variant={location === item.path ? 'secondary' : 'ghost'}
                    size="sm"
                    className="gap-2"
                    data-testid={`nav-${item.label.toLowerCase()}`}
                  >
                    <item.icon className="w-4 h-4" />
                    <span className="hidden sm:inline">{item.label}</span>
                  </Button>
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              data-testid="button-theme-toggle"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>

            {isLoading ? (
              <Button variant="outline" size="sm" disabled>
                Loading...
              </Button>
            ) : isLoggedIn ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground hidden md:block">
                  {userEmail || `${userAddress?.slice(0, 6)}...${userAddress?.slice(-4)}`}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={logout}
                  data-testid="button-logout"
                >
                  Disconnect
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                onClick={() => setShowLogin(true)}
                data-testid="button-connect"
              >
                Connect
              </Button>
            )}
          </div>
        </div>
      </header>

      <LoginModal open={showLogin} onClose={() => setShowLogin(false)} />
    </>
  );
}
