import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Portfolio from "@/pages/portfolio";
import InvestmentDetail from "@/pages/investment-detail";
import Projects from "@/pages/projects";
import RadioPage from "@/pages/radio";
import AssistantPage from "@/pages/assistant";
import CodeAgentPage from "@/pages/code-agent";
import GitHubAgentPage from "@/pages/github-agent";
import CeoDashboardPage from "@/pages/ceo-dashboard";
import AutomationManagerPage from "@/pages/automation-manager";
import ToolsPage from "@/pages/tools";
import AgentsOfficePage from "@/pages/agents-office";
import AuthPage from "@/pages/auth";

type AuthMe = {
  authenticated: boolean;
  sessionBacked?: boolean;
  usingDevFallback?: boolean;
  user?: { id: string; username: string };
};

const LOCAL_AUTH_USER_KEY = "blackops-local-auth-user";
const PREVIEW_USER = { id: "mock-user-123", username: "robert" };

function getLocalPreviewAuth(): AuthMe | null {
  if (typeof window === "undefined") return null;
  const isLocalPreview = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
  if (!isLocalPreview) return null;

  const stored = window.localStorage.getItem(LOCAL_AUTH_USER_KEY);
  if (!stored) return null;

  try {
    const user = JSON.parse(stored) as { id: string; username: string };
    if (!user?.id || !user?.username) return null;
    return { authenticated: true, sessionBacked: false, usingDevFallback: true, user };
  } catch {
    return null;
  }
}

function Router() {
  const hasLocalPreviewAuth = Boolean(getLocalPreviewAuth());
  const { data: auth, isLoading } = useQuery<AuthMe>({
    queryKey: ["auth-me"],
    queryFn: async () => {
      const localAuth = getLocalPreviewAuth();
      const response = await fetch("/api/auth/me");
      const contentType = response.headers.get("content-type") || "";
      if (response.status === 401) return localAuth || { authenticated: false };
      if (!response.ok || !contentType.includes("application/json")) {
        return localAuth || { authenticated: true, sessionBacked: false, usingDevFallback: true, user: PREVIEW_USER };
      }
      return response.json();
    },
    retry: false,
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(LOCAL_AUTH_USER_KEY);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-me"] });
    },
  });

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-black text-sm text-zinc-400">Cargando BlackOps...</div>;
  }

  if (!auth?.authenticated) {
    return <AuthPage />;
  }

  return (
    <>
      <div className="fixed right-3 top-3 z-50 flex items-center gap-2 rounded-lg border border-white/10 bg-black/80 px-2 py-1 text-xs text-zinc-300 backdrop-blur">
        <span className="max-w-[160px] truncate">{auth.user?.username || auth.user?.id}</span>
        {auth.usingDevFallback && <span className="rounded border border-amber-400/30 px-1.5 py-0.5 text-amber-200">dev</span>}
        {(auth.sessionBacked || hasLocalPreviewAuth) && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
            className="h-7 px-2 text-xs text-zinc-300 hover:text-white"
          >
            Salir
          </Button>
        )}
      </div>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/assistant" component={AssistantPage} />
        <Route path="/ceo" component={CeoDashboardPage} />
        <Route path="/tools" component={ToolsPage} />
        <Route path="/agents-office" component={AgentsOfficePage} />
        <Route path="/automations" component={AutomationManagerPage} />
        <Route path="/code-agent" component={CodeAgentPage} />
        <Route path="/github-agent" component={GitHubAgentPage} />
        <Route path="/portfolio" component={Portfolio} />
        <Route path="/portfolio/:symbol" component={InvestmentDetail} />
        <Route path="/projects" component={Projects} />
        <Route path="/radio" component={RadioPage} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
