import { createFileRoute } from "@tanstack/react-router";
import { getUserSupabase } from "@/lib/user-supabase.server";
import { verifyImageSig, STORAGE_BUCKET } from "@/lib/secure-image.server";

export const Route = createFileRoute("/api/img")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const path = url.searchParams.get("p");
        const sig = url.searchParams.get("sig");
        const wantDownload = url.searchParams.get("dl") !== "0";
        if (!path || !sig) return new Response("Bad request", { status: 400 });
        if (!(await verifyImageSig(path, sig))) {
          return new Response("Forbidden", { status: 403 });
        }
        try {
          const supabase = getUserSupabase();
          const { data, error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .download(path);
          if (error || !data) return new Response("Not found", { status: 404 });
          const buf = await data.arrayBuffer();
          const filename = path.split("/").pop() || "attachment";
          const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
          const disp = wantDownload ? "attachment" : "inline";
          return new Response(buf, {
            status: 200,
            headers: {
              "Content-Type": data.type || "application/octet-stream",
              "Content-Disposition": `${disp}; filename="${safe}"`,
              "Cache-Control": "private, max-age=60",
              "X-Content-Type-Options": "nosniff",
              "Referrer-Policy": "no-referrer",
            },
          });
        } catch {
          return new Response("Error", { status: 500 });
        }
      },
    },
  },
});