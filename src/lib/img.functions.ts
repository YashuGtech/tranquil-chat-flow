import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { buildSignedImageHref } from "./secure-image.server";

export const signImage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ url: z.string().min(1).max(2000) }).parse(d),
  )
  .handler(async ({ data }) => {
    const href = await buildSignedImageHref(data.url);
    return { href: href ?? data.url, proxied: !!href };
  });