import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Portfolio from "@/pages/portfolio";
import InvestmentDetail from "@/pages/investment-detail";
import Projects from "@/pages/projects";
import RadioPage from "@/pages/radio";
import AssistantPage from "@/pages/assistant";
import CodeAgentPage from "@/pages/code-agent";
import GitHubAgentPage from "@/pages/github-agent";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/assistant" component={AssistantPage} />
      <Route path="/code-agent" component={CodeAgentPage} />
      <Route path="/github-agent" component={GitHubAgentPage} />
      <Route path="/portfolio" component={Portfolio} />
      <Route path="/portfolio/:symbol" component={InvestmentDetail} />
      <Route path="/projects" component={Projects} />
      <Route path="/radio" component={RadioPage} />
      <Route component={NotFound} />
    </Switch>
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
