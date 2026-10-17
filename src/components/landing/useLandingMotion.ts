import { useEffect } from "react";
import type { CSSProperties } from "react";

/**
 * Inline style helper for sequenced reveals, e.g. style={revealDelay(120)}.
 */
export const revealDelay = (ms: number) =>
  ({ "--reveal-delay": `${ms}ms` }) as CSSProperties;

const REDUCE = "(prefers-reduced-motion: reduce)";

/**
 * Landing motion controller.
 *
 * Every effect here is decoration on top of a page that is already complete:
 * without JavaScript, in a browser with no IntersectionObserver, or with
 * reduced motion enabled, the visitor sees the final layout with no animation
 * and nothing hidden.
 *
 * The hook only
 *   1. marks reveal blocks as they scroll into view, so CSS owns the motion,
 *   2. writes --landing-progress for the thin scroll indicator.
 */
export default function useLandingMotion() {
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    const root = document.documentElement;
    const motion = window.matchMedia(REDUCE);
    const staticPage = motion.matches || !("IntersectionObserver" in window);
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };
    root.classList.add("js-reveal");
    cleanups.push(() => {
      timers.forEach((id) => window.clearTimeout(id));
      root.classList.remove("js-reveal");
    });

    /* --- 1. Scroll reveal ----------------------------------------------- */
    const container = document.querySelector<HTMLElement>(".landing");
    const targets = new Set<HTMLElement>();
    const observed = new WeakSet<HTMLElement>();
    const settle = (el: HTMLElement) => {
      if (el.classList.contains("is-revealed")) return;
      el.classList.add("is-revealed");
      later(() => el.classList.add("is-settled"), 1500);
    };
    const collect = (scope: Element) => {
      const found: HTMLElement[] = [];
      if (scope.matches("[data-reveal]")) found.push(scope as HTMLElement);
      scope
        .querySelectorAll<HTMLElement>("[data-reveal]")
        .forEach((el) => found.push(el));
      found.forEach((el) => targets.add(el));
      return found;
    };
    if (container) collect(container);
    if (staticPage) {
      // Reduced motion, or no observer: show every block right away.
      targets.forEach(settle);
    } else {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            settle(entry.target as HTMLElement);
            observer.unobserve(entry.target);
          }
        },
        { rootMargin: "0px 0px -6% 0px", threshold: 0.05 },
      );
      const watch = (el: HTMLElement) => {
        if (observed.has(el)) return;
        observed.add(el);
        observer.observe(el);
      };
      targets.forEach(watch);
      cleanups.push(() => observer.disconnect());
      // Blocks added later (a new template category, for example) reveal in
      // exactly the same way as the ones rendered on first paint.
      if (container) {
        const mutations = new MutationObserver((records) => {
          records.forEach((record) =>
            record.addedNodes.forEach((node) => {
              if (node instanceof HTMLElement)
                collect(node).forEach((el) => watch(el));
            }),
          );
        });
        mutations.observe(container, { childList: true, subtree: true });
        cleanups.push(() => mutations.disconnect());
      }
      // Safety net: whatever is already on screen is never left hidden, even
      // if the observer misses it for any reason.
      const sweep = () => {
        const limit = window.innerHeight + 60;
        let hidden = 0;
        targets.forEach((el) => {
          if (el.classList.contains("is-revealed")) return;
          if (el.getBoundingClientRect().top < limit) settle(el);
          else hidden += 1;
        });
        if (!hidden) window.removeEventListener("scroll", sweep);
      };
      later(sweep, 2500);
      window.addEventListener("scroll", sweep, { passive: true });
      cleanups.push(() => window.removeEventListener("scroll", sweep));
    }

    /* --- 2. Scroll progress --------------------------------------------- */
    const progress = document.querySelector<HTMLElement>(".landing-progress");
    if (progress && !motion.matches) {
      let frame = 0;
      const update = () => {
        frame = 0;
        const doc = document.documentElement;
        const max = doc.scrollHeight - window.innerHeight;
        const value =
          max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
        progress.style.setProperty("--landing-progress", value.toFixed(4));
      };
      const onScroll = () => {
        if (!frame) frame = window.requestAnimationFrame(update);
      };
      update();
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll, { passive: true });
      cleanups.push(() => {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
        if (frame) window.cancelAnimationFrame(frame);
      });
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);
}
