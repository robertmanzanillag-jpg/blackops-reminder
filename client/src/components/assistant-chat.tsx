import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export function AssistantChat() {
  return (
    <Link href="/assistant">
      <Button
        variant="ghost"
        size="icon"
        className="relative group h-7 w-7 md:h-10 md:w-10"
        data-testid="button-open-assistant"
      >
        <Bot className="h-4 w-4 md:h-6 md:w-6 group-hover:text-emerald-400 transition-colors" />
        <span className="absolute -top-0.5 -right-0.5 md:-top-1 md:-right-1 h-1.5 w-1.5 md:h-2 md:w-2 bg-emerald-500 rounded-full animate-pulse" />
      </Button>
    </Link>
  );
}
