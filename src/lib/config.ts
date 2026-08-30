export const DEFAULT_HUE = 240;
export const PAGE_WIDTH = "90rem";
export function getHue(): number {
  if (typeof window === "undefined") return DEFAULT_HUE;
  const stored = localStorage.getItem("hue");
  return stored ? parseInt(stored, 10) : DEFAULT_HUE;
}
export function setHue(hue: number) {
  localStorage.setItem("hue", String(hue));
  document.documentElement.style.setProperty("--hue", String(hue));
  document.getElementById("config-carrier")?.setAttribute("data-hue", String(hue));
}
