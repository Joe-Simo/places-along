import Link from "next/link";
import { Planner } from "@/components/planner";
import { initialQuestion } from "@/lib/examples";
import { status } from "@/lib/run";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: PageProps<"/">) {
  const s = status();
  const q = initialQuestion((await searchParams).q);
  return (
    <main className="mx-auto w-full max-w-6xl px-5 sm:px-8 py-10 sm:py-14">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Places Along</h1>
          <p className="mt-2 text-mute max-w-xl">Where to stop for coffee, EV charging, food, or a rest on a long drive. Asked two ways with <a className="underline underline-offset-4" href="https://www.geoapify.com/">Geoapify</a>: an agent through the Geoapify MCP server, and plain code through a typed OpenAPI client. Every call is shown.</p>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          {s.data === "sample" ? (
            <span className="rounded-full bg-warn-bg text-warn px-3 py-1 font-medium" title="No Geoapify key is set, so both paths answer from bundled sample data.">Sample data</span>
          ) : (
            <span className="rounded-full bg-road/10 text-road px-3 py-1 font-medium">Live Geoapify</span>
          )}
          <Link href="/tutorial" className="underline underline-offset-4">Tutorial</Link>
          <a href="https://github.com/Joe-Simo/places-along" className="underline underline-offset-4">Code</a>
        </nav>
      </header>

      <Planner initial={q} data={s.data} />

      <footer className="mt-14 border-t border-line pt-6 text-xs text-mute space-y-1.5 max-w-3xl">
        {s.data === "sample" ? (
          <p>Sample data, not Geoapify responses: the route is from the public OSRM demo server and the places from OpenStreetMap (data &copy; OpenStreetMap contributors, ODbL). Both paths run their real request code against it. With a <code>GEOAPIFY_API_KEY</code>, they call Geoapify instead.</p>
        ) : (
          <p>Live data from <a className="underline" href="https://www.geoapify.com/">Geoapify</a>, built on OpenStreetMap (&copy; OpenStreetMap contributors). This demo runs on a free key from Geoapify&apos;s Open Geospatial Program, so live runs share a daily allowance; repeated questions are answered from a one-hour cache.</p>
        )}
        <p>{s.model ? "The agent is driven by a free open model on OpenRouter; its answer only keeps places a Geoapify tool returned." : "The agent path follows a scripted plan with the same MCP tools, so it answers in seconds; a model can drive it when you run it yourself with an OpenRouter key."} Places Along is an independent project, not made by Geoapify. MIT licensed.</p>
      </footer>
    </main>
  );
}
