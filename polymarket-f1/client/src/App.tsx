import { Switch, Route } from 'wouter';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import Header from '@/components/Header';
import Markets from '@/pages/Markets';
import Portfolio from '@/pages/Portfolio';
import NotFound from '@/pages/NotFound';

function Router() {
  return (
    <Switch>
      <Route path="/" component={Markets} />
      <Route path="/portfolio" component={Portfolio} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1">
          <Router />
        </main>
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
