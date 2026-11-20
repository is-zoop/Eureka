import type mermaid from "mermaid";

type Mermaid = typeof mermaid;
declare global { interface Window { mermaid?: Mermaid } }
let pending: Promise<Mermaid> | undefined;

/** Load the same full Mermaid distribution, without compiling its dependency tree. */
export function loadMermaid(): Promise<Mermaid> {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (pending) return pending;
  const url = process.env.NEXT_PUBLIC_MERMAID_ASSET_URL;
  if (!url?.startsWith("/vendor/mermaid/")) return Promise.reject(new Error("Mermaid browser asset is unavailable"));
  const script = document.createElement("script");
  script.src = url; script.async = true;
  pending = new Promise<Mermaid>((resolve, reject) => {
    const timer = setTimeout(() => fail(), 30_000);
    const fail = () => { clearTimeout(timer); script.remove(); pending = undefined; reject(new Error("Mermaid browser asset could not be loaded")); };
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timer);
      if (!window.mermaid?.render || !window.mermaid.parse) { fail(); return; }
      resolve(window.mermaid);
    };
    document.head.appendChild(script);
  });
  return pending;
}
