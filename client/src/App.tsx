import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import AuthPage from "@/pages/auth";

const NotFound = lazy(() => import("@/pages/not-found"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Portfolio = lazy(() => import("@/pages/portfolio"));
const InvestmentDetail = lazy(() => import("@/pages/investment-detail"));
const Projects = lazy(() => import("@/pages/projects"));
const RadioPage = lazy(() => import("@/pages/radio"));
const PromoVideoPage = lazy(() => import("@/pages/promo-video"));
const ClippersPage = lazy(() => import("@/pages/clippers"));
const AssistantPage = lazy(() => import("@/pages/assistant"));
const CodeAgentPage = lazy(() => import("@/pages/code-agent"));
const GitHubAgentPage = lazy(() => import("@/pages/github-agent"));
const CeoDashboardPage = lazy(() => import("@/pages/ceo-dashboard"));
const AutomationManagerPage = lazy(() => import("@/pages/automation-manager"));
const ToolsPage = lazy(() => import("@/pages/tools"));
const AgentsOfficePage = lazy(() => import("@/pages/agents-office"));
const RevenueEnginePage = lazy(() => import("@/pages/revenue-engine"));
const DropshippingCeoPage = lazy(() => import("@/pages/dropshipping-ceo"));
const MarketingCommandCenterPage = lazy(() => import("@/pages/marketing-command-center"));
const CybersecurityAgentPage = lazy(() => import("@/pages/cybersecurity-agent"));
const AppQaAgentPage = lazy(() => import("@/pages/app-qa-agent"));
const LegalCompliancePage = lazy(() => import("@/pages/legal-compliance"));
const AiMediaStudioPage = lazy(() => import("@/pages/ai-media-studio"));

type AuthMe = {
  authenticated: boolean;
  sessionBacked?: boolean;
  usingDevFallback?: boolean;
  authServiceUnavailable?: boolean;
  user?: { id: string; username: string };
};

type AuthResolutionOptions = {
  hostname: string;
  isDevelopment: boolean;
  localAuth: AuthMe | null;
};

const LOCAL_AUTH_USER_KEY = "blackops-local-auth-user";
const PREVIEW_USER = { id: "mock-user-123", username: "robert" };

export function isPreviewFallbackAllowed(hostname: string, isDevelopment: boolean) {
  return isDevelopment || hostname === "127.0.0.1" || hostname === "localhost";
}

function resolveAuthServiceFailure({ hostname, isDevelopment, localAuth }: AuthResolutionOptions): AuthMe {
  if (isPreviewFallbackAllowed(hostname, isDevelopment)) {
    return localAuth || {
      authenticated: true,
      sessionBacked: false,
      usingDevFallback: true,
      user: PREVIEW_USER,
    };
  }

  return { authenticated: false, authServiceUnavailable: true };
}

export async function resolveAuthResponse(
  response: Response,
  options: AuthResolutionOptions,
): Promise<AuthMe> {
  if (response.status === 401) return options.localAuth || { authenticated: false };

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.includes("application/json")) {
    return resolveAuthServiceFailure(options);
  }

  try {
    return await response.json() as AuthMe;
  } catch {
    return resolveAuthServiceFailure(options);
  }
}

function getLocalPreviewAuth(): AuthMe | null {
  if (typeof window === "undefined") return null;
  const isLocalPreview = isPreviewFallbackAllowed(window.location.hostname, false);
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
  const { data: auth, isLoading, refetch } = useQuery<AuthMe>({
    queryKey: ["auth-me"],
    queryFn: async () => {
      const localAuth = getLocalPreviewAuth();
      const options: AuthResolutionOptions = {
        hostname: typeof window === "undefined" ? "" : window.location.hostname,
        isDevelopment: import.meta.env.DEV,
        localAuth,
      };

      try {
        const response = await fetch("/api/auth/me");
        return await resolveAuthResponse(response, options);
      } catch {
        return resolveAuthServiceFailure(options);
      }
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

  if (auth?.authServiceUnavailable) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black px-6 text-zinc-100">
        <div role="alert" className="w-full max-w-md rounded-xl border border-red-400/30 bg-red-950/20 p-6 text-center">
          <h1 className="text-lg font-semibold">No se pudo verificar tu sesion</h1>
          <p className="mt-2 text-sm text-zinc-400">
            El servicio de autenticacion no esta disponible. El acceso protegido permanece bloqueado.
          </p>
          <Button type="button" variant="outline" className="mt-5" onClick={() => void refetch()}>
            Reintentar
          </Button>
        </div>
      </div>
    );
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
      <Suspense fallback={<PageLoading />}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/assistant" component={AssistantPage} />
          <Route path="/ceo" component={CeoDashboardPage} />
          <Route path="/tools" component={ToolsPage} />
          <Route path="/agents-office" component={AgentsOfficePage} />
          <Route path="/revenue-engine" component={RevenueEnginePage} />
          <Route path="/dropshipping-ceo" component={DropshippingCeoPage} />
          <Route path="/marketing-command-center" component={MarketingCommandCenterPage} />
          <Route path="/cybersecurity-agent" component={CybersecurityAgentPage} />
          <Route path="/app-qa-agent" component={AppQaAgentPage} />
          <Route path="/legal-compliance" component={LegalCompliancePage} />
          <Route path="/ai-media-studio" component={AiMediaStudioPage} />
          <Route path="/automations" component={AutomationManagerPage} />
          <Route path="/code-agent" component={CodeAgentPage} />
          <Route path="/github-agent" component={GitHubAgentPage} />
          <Route path="/portfolio" component={Portfolio} />
          <Route path="/portfolio/:symbol" component={InvestmentDetail} />
          <Route path="/projects" component={Projects} />
          <Route path="/radio" component={RadioPage} />
          <Route path="/promo-video" component={PromoVideoPage} />
          <Route path="/clippers" component={ClippersPage} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </>
  );
}

function PageLoading() {
  return <div className="flex min-h-screen items-center justify-center bg-black text-sm text-zinc-400">Cargando modulo...</div>;
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
