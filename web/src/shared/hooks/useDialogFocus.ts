import { useEffect, type RefObject } from 'react';

/**
 * Focus the main content. It is focusable only while it holds focus: a
 * permanent tabindex made every mouse click land there, so the next Tab jumped
 * back to the top of the page.
 */
export function focusMain(): void {
  const main = document.getElementById('main');
  if (!main) return;
  // A click on text inside <main> would not blur it, so a press also ends it.
  const drop = () => {
    main.removeAttribute('tabindex');
    main.removeEventListener('blur', drop);
    document.removeEventListener('pointerdown', drop, true);
  };
  main.setAttribute('tabindex', '-1');
  main.addEventListener('blur', drop);
  document.addEventListener('pointerdown', drop, true);
  main.focus();
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * What a modal dialog owes a keyboard user (WCAG 2.4.3): focus moves in on
 * open, Tab and Shift+Tab stay inside, and focus returns to whatever opened it
 * on close. When the opener is gone, or disappears afterwards (the Ack button
 * of a problem just closed, once the list refreshes), focus goes to the main
 * content instead of falling to <body>.
 */
export function useDialogFocus(dialog: RefObject<HTMLElement>, initial?: RefObject<HTMLElement>): void {
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initial?.current ?? dialog.current)?.focus();
    // The element it was told to focus can be disabled, and focus would stay behind the dialog.
    if (!dialog.current?.contains(document.activeElement)) dialog.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      const box = dialog.current;
      if (e.key !== 'Tab' || !box) return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!first) {
        e.preventDefault();
        box.focus();
      } else if (e.shiftKey && (active === first || active === box || !box.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !box.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (!opener?.isConnected) return focusMain();
      opener.focus();
      // A button the same change switched off takes no focus, and the page would be left on <body>.
      if (document.activeElement !== opener) return focusMain();
      // Until focus moves on, catch the opener being removed by a later re-render.
      const back = opener;
      const watch = new MutationObserver(() => {
        if (back.isConnected) return;
        stop();
        if (!document.activeElement || document.activeElement === document.body) focusMain();
      });
      const onMove = (e: FocusEvent) => {
        if (e.target !== back) stop();
      };
      // A click on text blurs the opener with no focusin. Checked a tick later, because
      // removal blurs it too, and an app switch blurs it while it stays the active element.
      const onBlur = () =>
        setTimeout(() => {
          if (back.isConnected && document.activeElement !== back) stop();
        });
      function stop() {
        watch.disconnect();
        document.removeEventListener('focusin', onMove);
        back.removeEventListener('blur', onBlur);
      }
      watch.observe(document.body, { childList: true, subtree: true });
      document.addEventListener('focusin', onMove);
      back.addEventListener('blur', onBlur);
    };
    // Runs once per dialog: the refs are stable, and re-running would move focus mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
