import { useEffect, useRef } from "react";

/**
 * Shared dialog policy for drawers, forms, previews and destructive actions.
 *
 * - Escape is consumed only by the topmost dialog.
 * - Tab cycles inside the current dialog (nested overlays are supported).
 * - Underlying page scroll is locked until the final dialog closes.
 * - Original focus returns to the triggering control when possible.
 *
 * This hook intentionally owns behavior only. Visuals are expressed through
 * Liquid Stage tokens and the screen's existing layout classes.
 */
const layers: symbol[] = [];
let originalOverflow: string | null = null;
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export interface DialogBehaviorOptions {
  onClose: () => void;
  allowEscape?: boolean;
  focusSelector?: string;
}

export function useDialogBehavior({ onClose, allowEscape = true, focusSelector }: DialogBehaviorOptions) {
  const rootRef = useRef<HTMLDivElement>(null);
  const callback = useRef(onClose);
  const escEnabled = useRef(allowEscape);
  callback.current = onClose;
  escEnabled.current = allowEscape;

  useEffect(() => {
    const layer = Symbol("live-memory-dialog");
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    layers.push(layer);
    if (layers.length === 1) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    const root = rootRef.current;
    const first = (focusSelector ? root?.querySelector<HTMLElement>(focusSelector) : null) ||
      root?.querySelector<HTMLElement>(FOCUSABLE);
    const animation = window.requestAnimationFrame(() => first?.focus({ preventScroll: true }));

    const keydown = (event: KeyboardEvent) => {
      if (layers[layers.length - 1] !== layer || event.defaultPrevented) return;
      if (event.key === "Escape" && escEnabled.current) {
        event.preventDefault();
        event.stopPropagation();
        callback.current();
        return;
      }
      if (event.key !== "Tab" || !root) return;
      const candidates = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) =>
        element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
      if (!candidates.length) {
        event.preventDefault();
        return;
      }
      const firstItem = candidates[0], lastItem = candidates[candidates.length - 1];
      if (event.shiftKey && (document.activeElement === firstItem || !root.contains(document.activeElement))) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && (document.activeElement === lastItem || !root.contains(document.activeElement))) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", keydown, true);

    return () => {
      window.cancelAnimationFrame(animation);
      document.removeEventListener("keydown", keydown, true);
      const index = layers.indexOf(layer);
      if (index !== -1) layers.splice(index, 1);
      if (!layers.length) {
        document.body.style.overflow = originalOverflow || "";
        originalOverflow = null;
      }
      // Nested dialogs must not return focus to the covered underlying page.
      if (!layers.length || root?.contains(document.activeElement)) {
        previousFocus?.focus?.({ preventScroll: true });
      }
    };
  }, [focusSelector]);

  return rootRef;
}
