import { useEffect, useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { signImage } from "@/lib/img.functions";

const cache = new Map<string, string>();

function useSignedHref(url: string | null | undefined) {
  const sign = useServerFn(signImage);
  const [href, setHref] = useState<string | null>(() => (url ? cache.get(url) ?? null : null));
  const ranFor = useRef<string | null>(null);

  useEffect(() => {
    if (!url) { setHref(null); return; }
    const cached = cache.get(url);
    if (cached) { setHref(cached); return; }
    if (ranFor.current === url) return;
    ranFor.current = url;
    let cancelled = false;
    sign({ data: { url } })
      .then((r) => {
        if (cancelled) return;
        cache.set(url, r.href);
        setHref(r.href);
      })
      .catch(() => { if (!cancelled) setHref(null); });
    return () => { cancelled = true; };
  }, [url, sign]);

  return href;
}

/**
 * Renders an attached image without ever exposing the underlying storage URL.
 * Clicking the image triggers a download (the proxy serves Content-Disposition: attachment).
 */
export function SecureImage({
  url,
  alt,
  className,
  wrapperClassName,
  mode = "download",
}: {
  url: string | null | undefined;
  alt?: string;
  className?: string;
  wrapperClassName?: string;
  mode?: "download" | "inline";
}) {
  const signed = useSignedHref(url);
  if (!url) return null;
  const downloadHref = signed ?? "#";
  const inlineHref = signed ? `${signed}&dl=0` : "";

  function onClick(e: React.MouseEvent) {
    // Let the browser handle the download via the href + download attribute.
    if (!signed) e.preventDefault();
  }

  if (mode === "inline") {
    return inlineHref ? (
      <img
        src={inlineHref}
        alt={alt ?? "attachment"}
        className={(wrapperClassName ?? "block mt-2 ") + (className ?? "")}
        draggable={false}
        referrerPolicy="no-referrer"
      />
    ) : (
      <div
        className={
          (className ?? "") +
          " bg-secondary/40 animate-pulse rounded-lg flex items-center justify-center text-[10px] text-muted-foreground"
        }
        style={{ minHeight: 80 }}
      >
        loading…
      </div>
    );
  }

  return (
    <a
      href={downloadHref}
      onClick={onClick}
      download
      rel="noreferrer noopener"
      className={wrapperClassName ?? "block mt-2"}
      title="Click to download"
    >
      {inlineHref ? (
        <img
          src={inlineHref}
          alt={alt ?? "attachment"}
          className={className}
          draggable={false}
          referrerPolicy="no-referrer"
        />
      ) : (
        <div
          className={
            (className ?? "") +
            " bg-secondary/40 animate-pulse rounded-lg flex items-center justify-center text-[10px] text-muted-foreground"
          }
          style={{ minHeight: 80 }}
        >
          loading…
        </div>
      )}
    </a>
  );
}