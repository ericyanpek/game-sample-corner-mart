/// <reference types="vite/client" />

/** Public assets share the build's release prefix, including paths from Blender specs. */
export function assetUrl(url:string):string {
  return url.startsWith('/assets/')?import.meta.env.BASE_URL+url.slice(1):url;
}
