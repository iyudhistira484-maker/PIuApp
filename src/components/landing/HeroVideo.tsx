import { useEffect, useRef, useState } from "react";
import "./hero-video.css";
// Exact MP4 linked by the user's selected Pixabay page (video 35573, Animateon).
// A local deployment asset can replace this through the public URL setting.
export const HERO_VIDEO_URL =
  import.meta.env.VITE_HERO_VIDEO_URL ||
  "https://cdn.pixabay.com/video/2020/04/09/35573-407595474_large.mp4";
type Connection = EventTarget & { saveData?: boolean };
const connection = () =>
  (navigator as Navigator & { connection?: Connection }).connection;
const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export default function HeroVideo() {
  const video = useRef<HTMLVideoElement>(null),
    container = useRef<HTMLDivElement>(null);
  const [requested, setRequested] = useState(
      () => !reducedMotion() && !connection()?.saveData,
    ),
    [inView, setInView] = useState(false),
    [visible, setVisible] = useState(
      () => document.visibilityState === "visible",
    ),
    [mounted, setMounted] = useState(false),
    [failed, setFailed] = useState(false),
    [playing, setPlaying] = useState(false),
    [hasFrame, setHasFrame] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onPreference = () => {
      setRequested(!media.matches && !connection()?.saveData);
    };
    const onVisibility = () =>
      setVisible(document.visibilityState === "visible");
    media.addEventListener("change", onPreference);
    const net = connection();
    net?.addEventListener("change", onPreference);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      media.removeEventListener("change", onPreference);
      net?.removeEventListener("change", onPreference);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  useEffect(() => {
    if (!container.current) return;
    if (!("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.02 },
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (requested && inView && visible && !failed) setMounted(true);
  }, [requested, inView, visible, failed]);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let cancelled = false;
    if (requested && inView && visible && mounted && !failed) {
      element.muted = true;
      const promise = element.play();
      promise?.catch(() => {
        if (!cancelled) setRequested(false);
      });
    } else element.pause();
    return () => {
      cancelled = true;
    };
  }, [requested, inView, visible, mounted, failed]);
  const shouldPlay = requested && inView && visible && !failed;
  return (
    <div
      ref={container}
      className={
        "hero-video-media " +
        (playing ? "is-playing " : "") +
        (hasFrame ? "has-frame" : "")
      }
      aria-hidden="true"
      data-video-state={failed ? "fallback" : playing ? "playing" : "idle"}
    >
      <div className="hero-video-fallback" />
      {mounted && !failed && (
        <video
          ref={video}
          className="hero-background-video"
          src={HERO_VIDEO_URL}
          autoPlay={shouldPlay}
          muted
          controls={false}
          loop
          playsInline
          preload="none"
          tabIndex={-1}
          disablePictureInPicture
          disableRemotePlayback
          onPlaying={() => {
            setPlaying(true);
            setHasFrame(true);
          }}
          onPause={() => setPlaying(false)}
          onError={() => {
            setPlaying(false);
            setHasFrame(false);
            setFailed(true);
            setRequested(false);
          }}
        />
      )}
      <div className="hero-video-overlay" />
    </div>
  );
}
