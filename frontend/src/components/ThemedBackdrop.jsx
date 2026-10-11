// Shared page backdrop: a full-bleed themed image dimmed by an overlay.
// `fade` drives the fade-out class the chat page uses when it swaps
// images mid-session; static pages (e.g. /documents) just omit it.
const ThemedBackdrop = ({ src, fade = false }) => (
  <>
    <img src={src} alt="" className={`imgCover ${fade ? "fade-out" : ""}`} />
    <div className="bg-overlay" aria-hidden="true" />
  </>
);

export default ThemedBackdrop;
