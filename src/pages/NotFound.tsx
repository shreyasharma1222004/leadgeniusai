import { Button } from "@/components/ui/button";
import { Link } from "react-router";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <p className="tabular text-6xl font-semibold tracking-tight">404</p>
      <h1 className="mt-3 text-lg font-medium">
        This page slipped out of the pipeline.
      </h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        The link may be broken, or the page moved. Your leads are safe — they
        live at /leads.
      </p>
      <div className="mt-6 flex gap-2">
        <Button asChild>
          <Link to="/leads">Go to your leads</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/">Back home</Link>
        </Button>
      </div>
    </div>
  );
}
